package service

import (
	"fmt"
	"time"

	"aaru/internal/model"
	"aaru/internal/store"
)

type ReleaseService struct {
	store     *store.DBStore
	dmdb      *DMDBClient
	permSvc   *PermissionService
	bpService *BlueprintService
}

func NewReleaseService(s *store.DBStore, d *DMDBClient, p *PermissionService, bp *BlueprintService) *ReleaseService {
	return &ReleaseService{store: s, dmdb: d, permSvc: p, bpService: bp}
}

func (r *ReleaseService) CreateRelease(title, duCode, version string, createdByID uint, envCodes []string, blueprintID *uint) (*model.Release, error) {
	allEnvs, err := r.dmdb.ListEnvironments()
	if err != nil {
		return nil, fmt.Errorf("list environments: %w", err)
	}

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

	var siloName string
	silos, _ := r.dmdb.ListSilos()
	for _, s := range silos {
		if s.BizSerial == duInfo.SiloCode {
			siloName = s.Name
			break
		}
	}

	release := &model.Release{
		Title:          title,
		DeployUnitCode: duCode,
		DeployUnitName: duInfo.AppName,
		SiloCode:       duInfo.SiloCode,
		SiloName:       siloName,
		SystemName:     duInfo.SystemName,
		Version:        version,
		BlueprintID:    blueprintID,
		Status:         "draft",
		CreatedByID:    createdByID,
	}

	if err := r.store.CreateRelease(release); err != nil {
		return nil, fmt.Errorf("create release: %w", err)
	}

	var stages []model.ReleaseStage
	if blueprintID != nil {
		nodes, _ := r.store.GetBlueprintNodes(*blueprintID)
		for i, node := range nodes {
			nodeID := node.ID
			stages = append(stages, model.ReleaseStage{
				ReleaseID:      release.ID,
				NodeID:         &nodeID,
				EnvCode:        node.EnvCode,
				EnvName:        node.EnvName,
				PromotionOrder: i,
				GateType:       node.GateType,
				Status:         "pending",
			})
		}
	} else {
		envNameMap := make(map[string]string)
		for _, e := range allEnvs { envNameMap[e.Env] = e.Name }
		if len(envCodes) == 0 {
			for _, e := range allEnvs { envCodes = append(envCodes, e.Env) }
		}
		for i, code := range envCodes {
			name := envNameMap[code]
			if name == "" { name = code }
			stages = append(stages, model.ReleaseStage{
				ReleaseID: release.ID, EnvCode: code, EnvName: name,
				PromotionOrder: i, Status: "pending",
			})
		}
	}

	for i := range stages {
		if err := r.store.CreateReleaseStage(&stages[i]); err != nil {
			return nil, fmt.Errorf("create stage: %w", err)
		}
	}
	r.store.DB().Preload("Stages").First(release, release.ID)
	return release, nil
}

func (r *ReleaseService) StartRelease(releaseID, userID uint) (*model.Release, error) {
	if !r.permSvc.CanAction(userID, "deploy") {
		return nil, fmt.Errorf("permission denied")
	}
	release, err := r.store.GetReleaseWithStages(releaseID)
	if err != nil {
		return nil, err
	}
	if release.Status != "draft" {
		return nil, fmt.Errorf("release not in draft")
	}
	if len(release.Stages) == 0 {
		return nil, fmt.Errorf("no stages")
	}
	release.Status = "in_progress"
	r.store.DB().Save(release)

	if release.BlueprintID != nil {
		sources, _ := r.bpService.GetSourceNodeIDs(*release.BlueprintID)
		for i := range release.Stages {
			if release.Stages[i].NodeID != nil {
				for _, src := range sources {
					if *release.Stages[i].NodeID == src {
						release.Stages[i].Status = "in_progress"
						r.store.DB().Save(&release.Stages[i])
						r.autoProgress(releaseID, release.Stages[i].ID)
					}
				}
			}
		}
	} else {
		release.Stages[0].Status = "in_progress"
		r.store.DB().Save(&release.Stages[0])
	}
	r.store.DB().Preload("Stages").First(release, release.ID)
	return release, nil
}


func (r *ReleaseService) autoProgress(releaseID uint, stageID uint) {
	var stage model.ReleaseStage
	if err := r.store.DB().First(&stage, stageID).Error; err != nil {
		return
	}
	if stage.Status != "in_progress" || stage.GateType != "auto" {
		return
	}
	stage.Status = "approved"
	t := time.Now()
	stage.ApprovedAt = &t
	r.store.DB().Save(&stage)
	r.activateChildren(releaseID, *stage.NodeID)
}

func (r *ReleaseService) activateChildren(releaseID uint, nodeID uint) {
	release, _ := r.store.GetReleaseWithStages(releaseID)
	if release == nil || release.BlueprintID == nil {
		return
	}
	children, _ := r.bpService.GetChildNodeIDs(*release.BlueprintID, nodeID)
	for _, childID := range children {
		parents, _ := r.bpService.GetParentNodeIDs(*release.BlueprintID, childID)
		allApproved := true
		for _, pid := range parents {
			for j := range release.Stages {
				if release.Stages[j].NodeID != nil && *release.Stages[j].NodeID == pid &&
					release.Stages[j].Status != "approved" {
					allApproved = false
				}
			}
		}
		if allApproved {
			for j := range release.Stages {
				if release.Stages[j].NodeID != nil && *release.Stages[j].NodeID == childID {
					release.Stages[j].Status = "in_progress"
					r.store.DB().Save(&release.Stages[j])
					r.autoProgress(releaseID, release.Stages[j].ID)
				}
			}
		}
	}
}
func (r *ReleaseService) ApproveStage(stageID, userID uint, comment string) (*model.Release, error) {
	if !r.permSvc.CanAction(userID, "approve") {
		return nil, fmt.Errorf("permission denied")
	}
	var stage model.ReleaseStage
	if err := r.store.DB().First(&stage, stageID).Error; err != nil {
		return nil, fmt.Errorf("stage not found")
	}
	if stage.Status != "in_progress" {
		return nil, fmt.Errorf("stage not in progress")
	}
	stage.Status = "approved"
	stage.ApprovedByID = &userID
	stage.Comment = comment
	t := time.Now()
	stage.ApprovedAt = &t
	r.store.DB().Save(&stage)

	release, err := r.store.GetReleaseWithStages(stage.ReleaseID)
	if err != nil {
		return nil, err
	}

	if release.BlueprintID != nil && stage.NodeID != nil {
		children, _ := r.bpService.GetChildNodeIDs(*release.BlueprintID, *stage.NodeID)
		for _, childID := range children {
			parents, _ := r.bpService.GetParentNodeIDs(*release.BlueprintID, childID)
			allApproved := true
			for _, pid := range parents {
				for j := range release.Stages {
					if release.Stages[j].NodeID != nil && *release.Stages[j].NodeID == pid &&
						release.Stages[j].Status != "approved" {
						allApproved = false
					}
				}
			}
			if allApproved {
				for j := range release.Stages {
					if release.Stages[j].NodeID != nil && *release.Stages[j].NodeID == childID {
						release.Stages[j].Status = "in_progress"
						r.store.DB().Save(&release.Stages[j])
						r.autoProgress(release.ID, release.Stages[j].ID)
					}
				}
			}
		}

		isSink, _ := r.bpService.IsSinkNode(*release.BlueprintID, *stage.NodeID)
		if isSink {
			allSinksApproved := true
			for j := range release.Stages {
				if release.Stages[j].NodeID != nil {
					sink, _ := r.bpService.IsSinkNode(*release.BlueprintID, *release.Stages[j].NodeID)
					if sink && release.Stages[j].Status != "approved" {
						allSinksApproved = false
					}
				}
			}
			if allSinksApproved {
				release.Status = "completed"
				r.store.DB().Save(release)
			}
		}
	} else {
		for i, s := range release.Stages {
			if s.ID == stageID {
				if i+1 < len(release.Stages) {
					release.Stages[i+1].Status = "in_progress"
					r.store.DB().Save(&release.Stages[i+1])
				} else {
					release.Status = "completed"
					r.store.DB().Save(release)
				}
				break
			}
		}
	}

	r.store.DB().Preload("Stages").First(release, release.ID)
	return release, nil
}

func (r *ReleaseService) RejectStage(stageID, userID uint, comment string) (*model.Release, error) {
	if !r.permSvc.CanAction(userID, "approve") {
		return nil, fmt.Errorf("permission denied")
	}
	var stage model.ReleaseStage
	if err := r.store.DB().First(&stage, stageID).Error; err != nil {
		return nil, fmt.Errorf("stage not found")
	}
	if stage.Status != "in_progress" {
		return nil, fmt.Errorf("stage not in progress")
	}
	stage.Status = "rejected"
	stage.ApprovedByID = &userID
	stage.Comment = comment
	t := time.Now()
	stage.ApprovedAt = &t
	r.store.DB().Save(&stage)

	release, _ := r.store.GetReleaseWithStages(stage.ReleaseID)
	release.Status = "failed"
	r.store.DB().Save(release)
	r.store.DB().Preload("Stages").First(release, release.ID)
	return release, nil
}

func (r *ReleaseService) RollbackRelease(releaseID, userID uint) (*model.Release, error) {
	if !r.permSvc.CanAction(userID, "manage") {
		return nil, fmt.Errorf("permission denied")
	}
	release, _ := r.store.GetReleaseWithStages(releaseID)
	if release.Status != "completed" && release.Status != "in_progress" {
		return nil, fmt.Errorf("cannot rollback status: %s", release.Status)
	}
	release.Status = "rolled_back"
	for i := range release.Stages {
		if release.Stages[i].Status == "in_progress" {
			release.Stages[i].Status = "skipped"
			r.store.DB().Save(&release.Stages[i])
		}
	}
	r.store.DB().Save(release)
	return release, nil
}

func (r *ReleaseService) PromoteToNext(stageID, userID uint) (*model.Release, error) {
	if !r.permSvc.CanAction(userID, "deploy") {
		return nil, fmt.Errorf("permission denied")
	}
	var stage model.ReleaseStage
	if err := r.store.DB().First(&stage, stageID).Error; err != nil {
		return nil, fmt.Errorf("stage not found")
	}
	if stage.Status != "pending" {
		return nil, fmt.Errorf("stage not pending")
	}
	release, _ := r.store.GetReleaseWithStages(stage.ReleaseID)

	if release.BlueprintID != nil && stage.NodeID != nil {
		parents, _ := r.bpService.GetParentNodeIDs(*release.BlueprintID, *stage.NodeID)
		for _, pid := range parents {
			found := false
			for _, s := range release.Stages {
				if s.NodeID != nil && *s.NodeID == pid {
					if s.Status != "approved" {
						return nil, fmt.Errorf("parent stage not yet approved")
					}
					found = true
					break
				}
			}
			if !found {
				return nil, fmt.Errorf("parent stage not found")
			}
		}
	} else {
		if stage.PromotionOrder > 0 {
			for _, s := range release.Stages {
				if s.PromotionOrder == stage.PromotionOrder-1 && s.Status != "approved" {
					return nil, fmt.Errorf("previous stage not approved")
				}
			}
		}
	}

	stage.Status = "in_progress"
	r.store.DB().Save(&stage)
	r.store.DB().Preload("Stages").First(release, release.ID)
	return release, nil
}

func (r *ReleaseService) ListReleases(page, pageSize int) ([]model.Release, int64, error) {
	return r.store.ListReleases(page, pageSize)
}

func (r *ReleaseService) GetRelease(id uint) (*model.Release, error) {
	return r.store.GetReleaseWithStages(id)
}

func (r *ReleaseService) GetPendingApprovals(userID uint) ([]model.ReleaseStage, error) {
	if !r.permSvc.CanAction(userID, "approve") { return nil, nil }
	return r.store.GetStagesByStatus("in_progress")
}

// WebhookPromote 通过webhook token自动晋级（由外部系统调用）
func (r *ReleaseService) WebhookPromote(stageID uint, token string) (*model.Release, error) {
	// 找到对应的stage
	var stage model.ReleaseStage
	if err := r.store.DB().First(&stage, stageID).Error; err != nil {
		return nil, fmt.Errorf("stage not found")
	}
	if stage.Status != "pending" {
		return nil, fmt.Errorf("stage not pending")
	}

	release, err := r.store.GetReleaseWithStages(stage.ReleaseID)
	if err != nil {
		return nil, err
	}

	// 验证webhook token: 通过stage的NodeID找到蓝图层节点，核对token
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

	// DAG检查: 所有父节点必须已approved
	parents, _ := r.bpService.GetParentNodeIDs(*release.BlueprintID, *stage.NodeID)
	for _, pid := range parents {
		for _, s := range release.Stages {
			if s.NodeID != nil && *s.NodeID == pid {
				if s.Status != "approved" {
					return nil, fmt.Errorf("parent stage not yet approved")
				}
				break
			}
		}
	}

	stage.Status = "in_progress"
	r.store.DB().Save(&stage)

	r.store.DB().Preload("Stages").First(release, release.ID)
	return release, nil
}
