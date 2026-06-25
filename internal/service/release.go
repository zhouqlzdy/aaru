package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"gorm.io/gorm"

	"aaru/internal/model"
	"aaru/internal/store"
)

type ReleaseService struct {
	store     *store.DBStore
	dmdb      *DMDBClient
	permSvc   *PermissionService
	bpService *BlueprintService
	notifSvc  *NotificationService
}

func NewReleaseService(s *store.DBStore, d *DMDBClient, p *PermissionService, bp *BlueprintService) *ReleaseService {
	return &ReleaseService{store: s, dmdb: d, permSvc: p, bpService: bp}
}

func (r *ReleaseService) SetNotificationService(n *NotificationService) {
	r.notifSvc = n
}

// notifyStageActivated 发送 stage 激活通知（异步，不阻塞主流程）
func (r *ReleaseService) notifyStageActivated(release *model.Release, stage *model.ReleaseStage) {
	if r.notifSvc != nil {
		go r.notifSvc.NotifyStageActivated(release, stage)
	}
}

// loadStageAndRelease 加载 stage 及其所属 release
func (r *ReleaseService) loadStageAndRelease(stageID uint) (*model.ReleaseStage, *model.Release, error) {
	var stage model.ReleaseStage
	if err := r.store.DB().First(&stage, stageID).Error; err != nil {
		return nil, nil, fmt.Errorf("stage not found")
	}
	release, err := r.store.GetReleaseWithStages(stage.ReleaseID)
	if err != nil {
		return nil, nil, err
	}
	return &stage, release, nil
}

// allParentsCompleted 检查 stage 的所有父节点是否已完成
func (r *ReleaseService) allParentsCompleted(release *model.Release, stage *model.ReleaseStage) error {
	if release.BlueprintID == nil || stage.NodeID == nil {
		return nil
	}
	parents, _ := r.bpService.GetParentNodeIDs(*release.BlueprintID, *stage.NodeID)
	for _, pid := range parents {
		found := false
		for _, s := range release.Stages {
			if s.NodeID != nil && *s.NodeID == pid {
				if s.Status != "completed" {
					return fmt.Errorf("parent stage not yet completed")
				}
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("parent stage not found")
		}
	}
	return nil
}

// reloadRelease 重新加载 release（含 stages），用于操作后刷新数据。
func (r *ReleaseService) reloadRelease(release *model.Release) {
	if reloaded, err := r.store.GetReleaseWithStages(release.ID); err == nil {
		*release = *reloaded
	}
}

func (r *ReleaseService) CreateRelease(title, duCode string, createdByID uint, blueprintID uint, changes map[string]interface{}) (*model.Release, error) {
	allEnvs, err := r.dmdb.ListEnvironments()
	if err != nil {
		return nil, fmt.Errorf("list environments: %w", err)
	}

	// 查找 DU 信息（同时获取 siloCode 用于权限校验）
	var duInfo *model.DeployUnitInfo
	for _, env := range allEnvs {
		du, err := r.dmdb.GetDeployUnitByCode(env.Env, duCode)
		if err == nil && du != nil && du.BizSerial != "" {
			duInfo = du
			break
		}
	}
	if duInfo == nil {
		return nil, fmt.Errorf("deploy unit %s not found", duCode)
	}
	if !r.permSvc.CanDeploy(createdByID, duInfo.SiloCode) {
		return nil, fmt.Errorf("permission denied: no deploy access to silo %s", duInfo.SiloCode)
	}

	var siloName string
	silos, err := r.dmdb.ListSilos()
	if err == nil {
		for _, s := range silos {
			if s.BizSerial == duInfo.SiloCode {
				siloName = s.Name
				break
			}
		}
	}

	// 从 changes 中提取 version
	var version string
	if v, ok := changes["ArtifactVersion"]; ok {
		version = fmt.Sprintf("%v", v)
	}

	changesJSON := ""
	if len(changes) > 0 {
		b, err := json.Marshal(changes)
		if err != nil {
			return nil, fmt.Errorf("marshal changes: %w", err)
		}
		changesJSON = string(b)
	}

	release := &model.Release{
		Title:          title,
		DeployUnitCode: duCode,
		DeployUnitName: duInfo.AppName,
		SiloCode:       duInfo.SiloCode,
		SiloName:       siloName,
		SystemName:     duInfo.SystemName,
		Version:        version,
		BlueprintID:    &blueprintID,
		ChangesJSON:    changesJSON,
		Changes:        changes,
		Status:         "draft",
		CreatedByID:    createdByID,
	}

	if err := r.store.CreateRelease(release); err != nil {
		return nil, fmt.Errorf("create release: %w", err)
	}

	// 从蓝图创建 stages
	nodes, err := r.store.GetBlueprintNodes(blueprintID)
	if err != nil {
		return nil, fmt.Errorf("get blueprint nodes: %w", err)
	}
	if len(nodes) == 0 {
		return nil, fmt.Errorf("blueprint has no nodes")
	}
	for i, node := range nodes {
		nodeID := node.ID
		stage := model.ReleaseStage{
			ReleaseID:      release.ID,
			NodeID:         &nodeID,
			EnvCode:        node.EnvCode,
			EnvName:        node.EnvName,
			PromotionOrder: i,
			GateType:       node.GateType,
			Status:         "pending",
		}
		if err := r.store.CreateReleaseStage(&stage); err != nil {
			return nil, fmt.Errorf("create stage: %w", err)
		}
	}

	reloaded, err := r.store.GetReleaseWithStages(release.ID)
	if err != nil {
		return nil, fmt.Errorf("reload release: %w", err)
	}
	return reloaded, nil
}

// BatchCreateRelease 批量创建发布：多个DU共享同一蓝图和ArtifactVersion，
// 自动同步 initDb/initDbAuth/initDbFinal/ImportData 中的 URL tag。
// 每个DU创建一个独立的发布单。
func (r *ReleaseService) BatchCreateRelease(title string, duCodes []string, createdByID, blueprintID uint, newVersion string) ([]*model.Release, error) {
	if len(duCodes) == 0 {
		return nil, fmt.Errorf("no deploy units selected")
	}
	if newVersion == "" {
		return nil, fmt.Errorf("ArtifactVersion is required")
	}

	initDbFields := []string{"initDb", "initDbAuth", "initDbFinal", "ImportData"}

	var releases []*model.Release
	for _, duCode := range duCodes {
		// 获取该DU在所有环境的原始快照（不做折叠，保留initDb原始值用于tag更新）
		snapshots, err := r.dmdb.CompareDUConfigRaw(duCode)
		if err != nil {
			return nil, fmt.Errorf("compare du %s: %w", duCode, err)
		}

		// 构建 changes: ArtifactVersion + 自动同步的 initDb 字段
		changes := map[string]interface{}{
			"ArtifactVersion": newVersion,
		}

		// 对每个 initDb 字段，收集各环境的自动更新结果
		for _, field := range initDbFields {
			envUpdated := make(map[string]interface{})
			for _, snap := range snapshots {
				current, ok := snap.Fields[field]
				if !ok || current == "" {
					continue
				}
				updated := autoUpdateInitDbTag(current, newVersion)
				if updated != "" {
					var parsed interface{}
					if err := json.Unmarshal([]byte(updated), &parsed); err == nil {
						envUpdated[snap.Env] = parsed
					} else {
						envUpdated[snap.Env] = updated
					}
				}
			}
			if len(envUpdated) == 0 {
				continue
			}
			// 检查所有环境值是否相同
			first := ""
			allSame := true
			var firstVal interface{}
			for env, v := range envUpdated {
				b, _ := json.Marshal(v)
				s := string(b)
				if first == "" {
					first = s
					firstVal = v
				} else if s != first {
					allSame = false
					break
				}
				_ = env
			}
			if allSame {
				changes[field] = firstVal
			} else {
				// 使用 _default + 环境覆盖格式
				obj := map[string]interface{}{"_default": firstVal}
				for env, v := range envUpdated {
					b, _ := json.Marshal(v)
					if string(b) != first {
						obj[env] = v
					}
				}
				changes[field] = obj
			}
		}

		release, err := r.CreateRelease(title, duCode, createdByID, blueprintID, changes)
		if err != nil {
			return nil, fmt.Errorf("create release for %s: %w", duCode, err)
		}
		releases = append(releases, release)
	}
	return releases, nil
}

// autoUpdateInitDbTag 替换 initDb JSON 中 source URL 的 tag 部分
func autoUpdateInitDbTag(currentVal string, newVersion string) string {
	var arr []interface{}
	if err := json.Unmarshal([]byte(currentVal), &arr); err != nil {
		return ""
	}
	if len(arr) == 0 {
		return ""
	}
	changed := false
	for i, item := range arr {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		source, _ := m["source"].(string)
		if source == "" {
			continue
		}
		idx := strings.Index(source, "/blob/")
		if idx < 0 {
			continue
		}
		after := source[idx+6:]
		slashIdx := strings.Index(after, "/")
		if slashIdx < 0 {
			continue
		}
		oldTag := after[:slashIdx]
		if oldTag == newVersion {
			continue
		}
		newSource := source[:idx+6] + newVersion + after[slashIdx:]
		m["source"] = newSource
		arr[i] = m
		changed = true
	}
	if !changed {
		return ""
	}
	b, err := json.Marshal(arr)
	if err != nil {
		return ""
	}
	return string(b)
}

func (r *ReleaseService) StartRelease(releaseID, userID uint) (*model.Release, error) {
	release, err := r.store.GetReleaseWithStages(releaseID)
	if err != nil {
		return nil, err
	}
	if !r.permSvc.CanDeploy(userID, release.SiloCode) {
		return nil, fmt.Errorf("permission denied")
	}
	if release.Status != "draft" {
		return nil, fmt.Errorf("release not in draft")
	}
	if len(release.Stages) == 0 {
		return nil, fmt.Errorf("no stages")
	}
	if release.BlueprintID == nil {
		return nil, fmt.Errorf("blueprint required")
	}

	release.Status = "in_progress"
	if err := r.store.DB().Save(release).Error; err != nil {
		return nil, fmt.Errorf("save release: %w", err)
	}

	// 激活 source 节点（无入边的节点）
	sources, _ := r.bpService.GetSourceNodeIDs(*release.BlueprintID)
	for i := range release.Stages {
		if release.Stages[i].NodeID != nil {
			for _, src := range sources {
				if *release.Stages[i].NodeID == src {
					release.Stages[i].Status = "in_progress"
					if err := r.store.DB().Save(&release.Stages[i]).Error; err != nil {
						log.Printf("save stage %d: %v", release.Stages[i].ID, err)
					}
					r.notifyStageActivated(release, &release.Stages[i])
					r.autoProgress(releaseID, release.Stages[i].ID)
				}
			}
		}
	}

	r.reloadRelease(release)
	return release, nil
}

// autoProgress 处理 auto gate 的自动流转
func (r *ReleaseService) autoProgress(releaseID uint, stageID uint) {
	var stage model.ReleaseStage
	if err := r.store.DB().First(&stage, stageID).Error; err != nil {
		return
	}
	if stage.Status != "in_progress" || stage.GateType != "auto" {
		return
	}

	release, err := r.store.GetReleaseWithStages(releaseID)
	if err != nil {
		return
	}

	// auto gate: in_progress → approved → pushing → completed
	stage.Status = "approved"
	t := time.Now()
	stage.ApprovedAt = &t
	if err := r.store.DB().Save(&stage).Error; err != nil {
		log.Printf("autoProgress: save stage %d: %v", stageID, err)
		return
	}

	if err := r.applyChanges(release, &stage); err != nil {
		log.Printf("autoProgress: applyChanges stage %d: %v", stageID, err)
		return
	}

	r.activateChildren(releaseID, *stage.NodeID)

	// 重新加载 release 以检查是否完成
	release, err = r.store.GetReleaseWithStages(releaseID)
	if err == nil {
		r.checkReleaseCompleted(release)
	}
}

// resolveForEnv 将 changes 中的 per-env 对象解析为该环境的具体值
// 支持两种格式：
//   - 标量: "v2.1.0" → 所有环境统一
//   - 对象: {"_default":"v2.1.0", "prd3-focus":"v2.0.0"} → 按环境取值
func resolveForEnv(changes map[string]interface{}, envCode string) map[string]interface{} {
	result := make(map[string]interface{})
	for k, v := range changes {
		if m, ok := v.(map[string]interface{}); ok {
			if specific, ok := m[envCode]; ok {
				result[k] = specific
			} else if d, ok := m["_default"]; ok {
				result[k] = d
			}
		} else {
			result[k] = v
		}
	}
	return result
}

// applyChanges 将变更推送到 DMDB，stage 状态流转: approved → pushing → completed
func (r *ReleaseService) applyChanges(release *model.Release, stage *model.ReleaseStage) error {
	var changes map[string]interface{}
	if release.ChangesJSON != "" {
		if err := json.Unmarshal([]byte(release.ChangesJSON), &changes); err != nil {
			return fmt.Errorf("unmarshal changes: %w", err)
		}
	}

	// 无变更，直接 completed
	if len(changes) == 0 {
		stage.Status = "completed"
		return r.store.DB().Save(stage).Error
	}

	// 解析该环境的具体变更值
	envChanges := resolveForEnv(changes, stage.EnvCode)
	if len(envChanges) == 0 {
		stage.Status = "completed"
		return r.store.DB().Save(stage).Error
	}

	stage.Status = "pushing"
	if err := r.store.DB().Save(stage).Error; err != nil {
		return fmt.Errorf("save stage: %w", err)
	}

	// 获取DU的id和classCode
	id, classCode, err := r.dmdb.GetDeployUnitMeta(stage.EnvCode, release.DeployUnitCode)
	if err != nil {
		return fmt.Errorf("get du meta: %w", err)
	}

	// 构建更新项：id + classCode + 变更字段
	updateItem := map[string]interface{}{
		"id":        id,
		"classCode": classCode,
	}
	for k, v := range envChanges {
		updateItem[k] = v
	}

	results, err := r.dmdb.UpdateDeployUnit(stage.EnvCode, []map[string]interface{}{updateItem})
	if err != nil {
		return err
	}
	// 检查批量更新的逐项结果
	if len(results) > 0 && results[0].Status != "updated" {
		return fmt.Errorf("dmdb update failed: %s (id=%s)", results[0].Status, results[0].Id)
	}

	stage.Status = "completed"
	return r.store.DB().Save(stage).Error
}

// activateChildren 激活子节点（所有父节点 completed 后）
func (r *ReleaseService) activateChildren(releaseID uint, nodeID uint) {
	release, err := r.store.GetReleaseWithStages(releaseID)
	if err != nil || release == nil || release.BlueprintID == nil {
		return
	}
	children, _ := r.bpService.GetChildNodeIDs(*release.BlueprintID, nodeID)
	for _, childID := range children {
		parents, _ := r.bpService.GetParentNodeIDs(*release.BlueprintID, childID)
		allCompleted := true
		for _, pid := range parents {
			found := false
			for j := range release.Stages {
				if release.Stages[j].NodeID != nil && *release.Stages[j].NodeID == pid {
					found = true
					if release.Stages[j].Status != "completed" {
						allCompleted = false
					}
					break
				}
			}
			if !found {
				allCompleted = false
			}
		}
		if allCompleted {
			for j := range release.Stages {
				if release.Stages[j].NodeID != nil && *release.Stages[j].NodeID == childID &&
					release.Stages[j].Status == "pending" {
					release.Stages[j].Status = "in_progress"
					r.store.DB().Save(&release.Stages[j])
					r.notifyStageActivated(release, &release.Stages[j])
					r.autoProgress(releaseID, release.Stages[j].ID)
				}
			}
		}
	}
}

// checkReleaseCompleted 检查是否所有 sink 节点都已完成
func (r *ReleaseService) checkReleaseCompleted(release *model.Release) {
	if release.BlueprintID == nil {
		return
	}
	// 重新加载 release 以获取最新的 stage 状态（stage 可能已通过独立对象保存到 DB）
	fresh, err := r.store.GetReleaseWithStages(release.ID)
	if err != nil {
		return
	}
	for j := range fresh.Stages {
		if fresh.Stages[j].NodeID != nil {
			isSink, _ := r.bpService.IsSinkNode(*fresh.BlueprintID, *fresh.Stages[j].NodeID)
			if isSink && fresh.Stages[j].Status != "completed" {
				return
			}
		}
	}
	fresh.Status = "completed"
	r.store.DB().Save(fresh)
}

func (r *ReleaseService) ApproveStage(stageID, userID uint, comment string) (*model.Release, error) {
	stage, release, err := r.loadStageAndRelease(stageID)
	if err != nil {
		return nil, err
	}
	if stage.Status != "in_progress" {
		return nil, fmt.Errorf("stage not in progress")
	}
	if release.Status == "deprecated" {
		return nil, fmt.Errorf("release is deprecated, cannot approve")
	}
	if !r.permSvc.CanApprove(userID, release.SiloCode, stage.EnvCode) {
		return nil, fmt.Errorf("permission denied")
	}

	stage.Status = "approved"
	stage.ApprovedByID = &userID
	stage.Comment = comment
	t := time.Now()
	stage.ApprovedAt = &t
	if err := r.store.DB().Save(stage).Error; err != nil {
		return nil, fmt.Errorf("save stage: %w", err)
	}

	// 推送变更到 DMDB
	if err := r.applyChanges(release, stage); err != nil {
		// 推送失败，stage 停留在 pushing，返回错误
		r.reloadRelease(release)
		return release, fmt.Errorf("config push failed: %w (stage stuck in pushing, use retry)", err)
	}

	// 激活子节点
	r.activateChildren(release.ID, *stage.NodeID)
	r.checkReleaseCompleted(release)

	r.reloadRelease(release)
	return release, nil
}

func (r *ReleaseService) RejectStage(stageID, userID uint, comment string) (*model.Release, error) {
	stage, release, err := r.loadStageAndRelease(stageID)
	if err != nil {
		return nil, err
	}
	if stage.Status != "in_progress" {
		return nil, fmt.Errorf("stage not in progress")
	}
	if release.Status == "deprecated" {
		return nil, fmt.Errorf("release is deprecated, cannot reject")
	}
	if !r.permSvc.CanApprove(userID, release.SiloCode, stage.EnvCode) {
		return nil, fmt.Errorf("permission denied")
	}
	stage.Status = "rejected"
	stage.ApprovedByID = &userID
	stage.Comment = comment
	t := time.Now()
	stage.ApprovedAt = &t
	if err := r.store.DB().Save(stage).Error; err != nil {
		return nil, fmt.Errorf("save stage: %w", err)
	}

	release.Status = "failed"
	if err := r.store.DB().Save(release).Error; err != nil {
		return nil, fmt.Errorf("save release: %w", err)
	}
	r.reloadRelease(release)
	return release, nil
}

func (r *ReleaseService) PromoteToNext(stageID, userID uint) (*model.Release, error) {
	stage, release, err := r.loadStageAndRelease(stageID)
	if err != nil {
		return nil, err
	}
	if stage.Status != "pending" {
		return nil, fmt.Errorf("stage not pending")
	}
	if release.Status == "deprecated" {
		return nil, fmt.Errorf("release is deprecated, cannot promote")
	}
	if !r.permSvc.CanDeploy(userID, release.SiloCode) {
		return nil, fmt.Errorf("permission denied")
	}
	if release.BlueprintID == nil {
		return nil, fmt.Errorf("blueprint required")
	}
	if stage.NodeID == nil {
		return nil, fmt.Errorf("stage has no node")
	}
	if err := r.allParentsCompleted(release, stage); err != nil {
		return nil, err
	}

	stage.Status = "in_progress"
	if err := r.store.DB().Save(stage).Error; err != nil {
		return nil, fmt.Errorf("save stage: %w", err)
	}
	r.notifyStageActivated(release, stage)
	r.autoProgress(release.ID, stage.ID)

	r.reloadRelease(release)
	return release, nil
}

// RetryPush 重试停留在 pushing 状态的 stage
func (r *ReleaseService) RetryPush(stageID, userID uint) (*model.Release, error) {
	stage, release, err := r.loadStageAndRelease(stageID)
	if err != nil {
		return nil, err
	}
	if stage.Status != "pushing" {
		return nil, fmt.Errorf("stage not in pushing status")
	}
	if release.Status == "deprecated" {
		return nil, fmt.Errorf("release is deprecated, cannot retry push")
	}
	if !r.permSvc.CanDeploy(userID, release.SiloCode) {
		return nil, fmt.Errorf("permission denied")
	}

	if err := r.applyChanges(release, stage); err != nil {
		r.reloadRelease(release)
		return release, fmt.Errorf("retry push failed: %w", err)
	}

	r.activateChildren(release.ID, *stage.NodeID)
	r.checkReleaseCompleted(release)

	r.reloadRelease(release)
	return release, nil
}

func (r *ReleaseService) ListReleases(page, pageSize int, userID uint) ([]model.Release, int64, error) {
	// developer 角色只能看到自己创建的发布
	user, err := r.store.GetUserWithRoles(userID)
	filterUserID := uint(0)
	if err == nil {
		if hasRole(user, "developer") && !hasRole(user, "admin") {
			filterUserID = userID
		}
	}
	return r.store.ListReleases(page, pageSize, filterUserID)
}

func hasRole(user *model.User, roleName string) bool {
	for _, role := range user.Roles {
		if role.Name == roleName {
			return true
		}
	}
	return false
}

func (r *ReleaseService) GetRelease(id uint) (*model.Release, error) {
	return r.store.GetReleaseWithStages(id)
}

func (r *ReleaseService) GetPendingApprovals(userID uint) ([]model.ReleaseStage, error) {
	if !r.permSvc.CanAction(userID, "approve") {
		return nil, fmt.Errorf("permission denied")
	}

	allStages, err := r.store.GetStagesByStatus("in_progress")
	if err != nil {
		return nil, err
	}

	// admin 看所有
	user, _ := r.store.GetUserWithRoles(userID)
	if user != nil && hasRole(user, "admin") {
		return allStages, nil
	}

	// 按用户 silo + env 过滤（Release 已由 GetStagesByStatus 预加载）
	var filtered []model.ReleaseStage
	for _, stage := range allStages {
		if stage.Release != nil && r.permSvc.CanApprove(userID, stage.Release.SiloCode, stage.EnvCode) {
			filtered = append(filtered, stage)
		}
	}
	return filtered, nil
}

func (r *ReleaseService) GetApprovalHistory(userID uint) ([]model.ReleaseStage, error) {
	if !r.permSvc.CanAction(userID, "approve") {
		return nil, fmt.Errorf("permission denied")
	}
	return r.store.GetApprovalHistoryByUser(userID)
}

// DeprecateRelease 废弃发布：不允许再审批，废弃后一周内可删除
func (r *ReleaseService) DeprecateRelease(releaseID, userID uint) (*model.Release, error) {
	release, err := r.store.GetReleaseWithStages(releaseID)
	if err != nil {
		return nil, fmt.Errorf("get release: %w", err)
	}
	if release.Status == "deprecated" {
		return nil, fmt.Errorf("release already deprecated")
	}
	if release.Status == "completed" {
		return nil, fmt.Errorf("cannot deprecate completed release")
	}
	// 创建者或 admin 可以废弃
	user, err := r.store.GetUserWithRoles(userID)
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	isAdmin := hasRole(user, "admin")
	if !isAdmin && release.CreatedByID != userID {
		return nil, fmt.Errorf("permission denied: only creator or admin can deprecate")
	}

	now := time.Now()
	release.Status = "deprecated"
	release.DeprecatedAt = &now

	// 将 in_progress/pending 的 stage 标记为 skipped
	for i := range release.Stages {
		if release.Stages[i].Status == "in_progress" || release.Stages[i].Status == "pending" || release.Stages[i].Status == "pushing" {
			release.Stages[i].Status = "skipped"
			r.store.DB().Save(&release.Stages[i])
		}
	}

	if err := r.store.DB().Save(release).Error; err != nil {
		return nil, fmt.Errorf("save release: %w", err)
	}
	r.reloadRelease(release)
	return release, nil
}

// DeleteRelease 删除发布：admin 可删除已废弃的发布（一周内），创建者可删除草稿或已废弃的发布（一周内）
func (r *ReleaseService) DeleteRelease(releaseID, userID uint) error {
	release, err := r.store.GetRelease(releaseID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("release not found")
		}
		return fmt.Errorf("get release: %w", err)
	}
	user, err := r.store.GetUserWithRoles(userID)
	if err != nil {
		return fmt.Errorf("get user: %w", err)
	}
	isAdmin := hasRole(user, "admin")
	isCreator := release.CreatedByID == userID

	if release.Status == "draft" {
		// 草稿：创建者可删除
		if !isCreator {
			return fmt.Errorf("permission denied: only creator can delete draft releases")
		}
		return r.store.DeleteRelease(releaseID)
	}

	if release.Status == "deprecated" {
		if release.DeprecatedAt == nil {
			return fmt.Errorf("release has no deprecated timestamp")
		}
		if time.Since(*release.DeprecatedAt) > 7*24*time.Hour {
			return fmt.Errorf("deprecation window expired (7 days), cannot delete")
		}
		// 已废弃：admin 或创建者可删除
		if !isAdmin && !isCreator {
			return fmt.Errorf("permission denied: only admin or creator can delete deprecated releases")
		}
		return r.store.DeleteRelease(releaseID)
	}

	return fmt.Errorf("only draft or deprecated releases can be deleted")
}

// WebhookPromote 通过webhook token自动晋级（由外部系统调用）
func (r *ReleaseService) WebhookPromote(stageID uint, token string) (*model.Release, error) {
	stage, release, err := r.loadStageAndRelease(stageID)
	if err != nil {
		return nil, err
	}
	if stage.Status != "pending" {
		return nil, fmt.Errorf("stage not pending")
	}
	if release.Status == "deprecated" {
		return nil, fmt.Errorf("release is deprecated, cannot promote")
	}
	if release.BlueprintID == nil || stage.NodeID == nil {
		return nil, fmt.Errorf("not a blueprint release")
	}

	nodes, _ := r.store.GetBlueprintNodes(*release.BlueprintID)
	var bpNode *model.BlueprintNode
	for i := range nodes {
		if nodes[i].ID == *stage.NodeID {
			bpNode = &nodes[i]
			break
		}
	}
	if bpNode == nil {
		return nil, fmt.Errorf("blueprint node not found")
	}
	if bpNode.GateType != "api_hook" {
		return nil, fmt.Errorf("this stage is not an api_hook gate")
	}
	if bpNode.WebhookToken == "" || bpNode.WebhookToken != token {
		return nil, fmt.Errorf("invalid webhook token")
	}

	if err := r.allParentsCompleted(release, stage); err != nil {
		return nil, err
	}

	stage.Status = "in_progress"
	if err := r.store.DB().Save(stage).Error; err != nil {
		return nil, fmt.Errorf("save stage: %w", err)
	}
	r.notifyStageActivated(release, stage)
	r.autoProgress(release.ID, stage.ID)

	r.reloadRelease(release)
	return release, nil
}
