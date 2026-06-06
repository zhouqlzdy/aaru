package service

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"aaru/internal/model"
	"aaru/internal/store"
)

type NotificationService struct {
	store    *store.DBStore
	permSvc  *PermissionService
	client   *http.Client
}

func NewNotificationService(s *store.DBStore, p *PermissionService) *NotificationService {
	return &NotificationService{
		store:   s,
		permSvc: p,
		client: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
	}
}

// GetConfig 获取通知配置
func (n *NotificationService) GetConfig() (*model.NotificationConfig, error) {
	return n.store.GetNotificationConfig()
}

// SaveConfig 保存通知配置
func (n *NotificationService) SaveConfig(cfg *model.NotificationConfig) error {
	return n.store.SaveNotificationConfig(cfg)
}

// NotifyStageActivated 当 stage 进入 in_progress 时，发送机器人通知
func (n *NotificationService) NotifyStageActivated(release *model.Release, stage *model.ReleaseStage) {
	cfg, err := n.store.GetNotificationConfig()
	if err != nil {
		log.Printf("notify: load config: %v", err)
		return
	}

	// 检查该环境是否配置了 webhook
	webhook, ok := cfg.EnvWebhooks[stage.EnvCode]
	if !ok || webhook == "" {
		return
	}

	// 查找可审批人
	approvers := n.findApprovers(release.SiloCode, stage.EnvCode)
	approverNames := make([]string, 0, len(approvers))
	for _, u := range approvers {
		approverNames = append(approverNames, u.Username)
	}

	// 构建审批链接
	approvalLink := ""
	if cfg.AaruDomain != "" {
		approvalLink = fmt.Sprintf("%s/#/release-detail/%d", strings.TrimRight(cfg.AaruDomain, "/"), release.ID)
	}

	// 构建消息内容
	var content strings.Builder
	fmt.Fprintf(&content, "发布单：#%d %s\n", release.ID, release.Title)
	fmt.Fprintf(&content, "部署单元：%s\n", release.DeployUnitCode)
	fmt.Fprintf(&content, "版本：%s\n", release.Version)
	fmt.Fprintf(&content, "环境：%s (%s)\n", stage.EnvName, stage.EnvCode)
	fmt.Fprintf(&content, "状态：待审批\n\n")

	if len(approverNames) > 0 {
		fmt.Fprintf(&content, "可审批人：%s\n", strings.Join(approverNames, "、"))
	} else {
		content.WriteString("可审批人：暂无（请在权限管理中配置）\n")
	}

	if approvalLink != "" {
		fmt.Fprintf(&content, "\n👉 前往审批：%s", approvalLink)
	}

	title := fmt.Sprintf("🔔 %s — %s 环境待审批", release.Title, stage.EnvName)
	n.sendWebhook(webhook, title, content.String())
}

// findApprovers 查找有权审批指定 silo+env 的用户
func (n *NotificationService) findApprovers(siloCode, envCode string) []model.User {
	users, err := n.store.ListUsers()
	if err != nil {
		return nil
	}
	var result []model.User
	for _, u := range users {
		if n.permSvc.CanApprove(u.ID, siloCode, envCode) {
			result = append(result, u)
		}
	}
	return result
}

// sendWebhook 发送 CCWork 机器人消息
func (n *NotificationService) sendWebhook(webhook, title, content string) {
	msg := map[string]interface{}{
		"type": "attachment",
		"message": map[string]interface{}{
			"id":        fmt.Sprintf("%d", time.Now().UnixNano()),
			"value":     title,
			"url":       nil,
			"avatartype": 0,
			"summary":   title,
			"head": map[string]interface{}{
				"text":   title,
				"tcolor": "FC6D26",
			},
			"body": map[string]interface{}{
				"content": content,
			},
		},
	}

	body, err := json.Marshal(msg)
	if err != nil {
		log.Printf("notify: marshal: %v", err)
		return
	}

	go func() {
		resp, err := n.client.Post(webhook, "application/json", strings.NewReader(string(body)))
		if err != nil {
			log.Printf("notify: post %s: %v", webhook, err)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			log.Printf("notify: post %s: status %d", webhook, resp.StatusCode)
		}
	}()
}
