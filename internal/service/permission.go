package service

import (
	"strings"

	"aaru/internal/model"
	"aaru/internal/store"
)

type PermissionService struct {
	store *store.DBStore
}

func NewPermissionService(s *store.DBStore) *PermissionService {
	return &PermissionService{store: s}
}

// Can 检查用户是否对指定部署单元有指定操作权限
func (p *PermissionService) Can(userID uint, deployUnitCode string, action string) bool {
	user, err := p.store.GetUserWithRoles(userID)
	if err != nil || user == nil {
		return false
	}
	for _, role := range user.Roles {
		var permissions []model.Permission
		if err := p.store.DB().Model(&role).Association("Permissions").Find(&permissions); err != nil {
			continue
		}
		for _, perm := range permissions {
			if perm.Action == action && (perm.DeployUnitCode == "" || perm.DeployUnitCode == "*" || perm.DeployUnitCode == deployUnitCode) {
				return true
			}
		}
	}
	return false
}

// CanAction 更通用的权限检查
func (p *PermissionService) CanAction(userID uint, action string) bool {
	user, err := p.store.GetUserWithRoles(userID)
	if err != nil || user == nil {
		return false
	}
	for _, role := range user.Roles {
		var permissions []model.Permission
		if err := p.store.DB().Model(&role).Association("Permissions").Find(&permissions); err != nil {
			continue
		}
		for _, perm := range permissions {
			if perm.Action == action {
				return true
			}
		}
	}
	return false
}

// GetUserPermittedDUs 获取用户有权限的部署单元列表
func (p *PermissionService) GetUserPermittedDUs(userID uint) (map[string]bool, error) {
	user, err := p.store.GetUserWithRoles(userID)
	if err != nil || user == nil {
		return nil, err
	}
	result := make(map[string]bool)
	for _, role := range user.Roles {
		var permissions []model.Permission
		if err := p.store.DB().Model(&role).Association("Permissions").Find(&permissions); err != nil {
			continue
		}
		for _, perm := range permissions {
			if perm.DeployUnitCode == "*" || perm.DeployUnitCode == "" {
				result["*"] = true
			} else {
				result[perm.DeployUnitCode] = true
			}
		}
	}
	return result, nil
}

// hasRole 检查用户是否有指定角色
func (p *PermissionService) hasRole(user *model.User, roleName string) bool {
	for _, role := range user.Roles {
		if role.Name == roleName {
			return true
		}
	}
	return false
}

// isAllowed 检查值是否在逗号分隔的列表中（支持 * 通配）
func isAllowed(list string, value string) bool {
	if list == "" {
		return false
	}
	if list == "*" {
		return true
	}
	for _, item := range splitList(list) {
		if item == value {
			return true
		}
	}
	return false
}

func splitList(s string) []string {
	var result []string
	for _, item := range strings.Split(s, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			result = append(result, item)
		}
	}
	return result
}

// CanDeploy 检查用户是否可以发布指定 silo 的 DU
// admin 跳过 silo 检查；developer 需要 allowed_silos 包含 silo
func (p *PermissionService) CanDeploy(userID uint, siloCode string) bool {
	user, err := p.store.GetUserWithRoles(userID)
	if err != nil || user == nil {
		return false
	}
	// admin 跳过
	if p.hasRole(user, "admin") {
		return true
	}
	// 需要 deploy 权限
	if !p.CanAction(userID, "deploy") {
		return false
	}
	return isAllowed(user.AllowedSilos, siloCode)
}

// CanApprove 检查用户是否可以审批指定 silo + env 的 stage
// admin 跳过检查；operator 需要 allowed_silos 包含 silo 且 allowed_envs 包含 env
func (p *PermissionService) CanApprove(userID uint, siloCode, envCode string) bool {
	user, err := p.store.GetUserWithRoles(userID)
	if err != nil || user == nil {
		return false
	}
	// admin 跳过
	if p.hasRole(user, "admin") {
		return true
	}
	// 需要 approve 权限
	if !p.CanAction(userID, "approve") {
		return false
	}
	return isAllowed(user.AllowedSilos, siloCode) && isAllowed(user.AllowedEnvs, envCode)
}
