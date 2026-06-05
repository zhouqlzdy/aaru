package store

import (
	"fmt"

	"aaru/internal/model"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type DBStore struct{ db *gorm.DB }

func NewDBStore(dsn string) (*DBStore, error) {
	if dsn == "" {
		return nil, fmt.Errorf("mysql dsn is required")
	}

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, err
	}
	if err := db.AutoMigrate(
		&model.User{}, &model.Role{}, &model.Permission{},
		&model.Release{}, &model.ReleaseStage{},
		&model.PromotionBlueprint{}, &model.BlueprintNode{}, &model.BlueprintEdge{},
	); err != nil {
		return nil, err
	}
	return &DBStore{db: db}, nil
}

func (s *DBStore) DB() *gorm.DB { return s.db }

// ========== User ==========
func (s *DBStore) CreateUser(u *model.User) error { return s.db.Create(u).Error }

// FindOrCreateUser 按用户名查找，不存在则创建，返回是否为新用户。
func (s *DBStore) FindOrCreateUser(u *model.User) (isNew bool, err error) {
	u.ID = 0 // 清除可能残留的 ID，避免主键冲突
	result := s.db.Where("username = ?", u.Username).FirstOrCreate(u)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

func (s *DBStore) GetUserByUsername(name string) (*model.User, error) {
	var u model.User
	err := s.db.Where("username = ?", name).Preload("Roles.Permissions").First(&u).Error
	if err != nil {
		return nil, err
	}
	return &u, nil
}
func (s *DBStore) GetUserWithRoles(id uint) (*model.User, error) {
	var u model.User
	err := s.db.Preload("Roles.Permissions").First(&u, id).Error
	if err != nil {
		return nil, err
	}
	return &u, nil
}
func (s *DBStore) ListUsers() ([]model.User, error) {
	var users []model.User
	err := s.db.Preload("Roles.Permissions").Find(&users).Error
	return users, err
}
func (s *DBStore) SetUserRoles(userID uint, roleIDs []uint) error {
	var u model.User
	if err := s.db.First(&u, userID).Error; err != nil {
		return err
	}
	var roles []model.Role
	if err := s.db.Where("id IN ?", roleIDs).Find(&roles).Error; err != nil {
		return err
	}
	return s.db.Model(&u).Association("Roles").Replace(&roles)
}
func (s *DBStore) UpdateUserAccess(userID uint, allowedSilos, allowedEnvs string) error {
	return s.db.Model(&model.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
		"allowed_silos": allowedSilos,
		"allowed_envs":  allowedEnvs,
	}).Error
}

// SetAdminWildcard 为所有 admin 角色用户设置 allowed_silos="*"
func (s *DBStore) SetAdminWildcard() {
	s.db.Exec(`UPDATE users SET allowed_silos = '*', allowed_envs = '*' WHERE (allowed_silos IS NULL OR allowed_silos = '') AND id IN (
		SELECT user_id FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE name = 'admin')
	)`)
}

// CleanupApproverRoles 清理废弃的 approver-* 环境审批角色
func (s *DBStore) CleanupApproverRoles() {
	// 解除蓝图节点对 approver 角色的引用
	s.db.Exec(`UPDATE blueprint_nodes SET approve_role_id = NULL WHERE approve_role_id IN (SELECT id FROM roles WHERE name LIKE 'approver-%')`)
	// 解除用户与 approver 角色的关联
	s.db.Exec(`DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE name LIKE 'approver-%')`)
	// 删除 approver 角色的权限
	s.db.Exec(`DELETE FROM permissions WHERE role_id IN (SELECT id FROM roles WHERE name LIKE 'approver-%')`)
	// 删除 approver 角色
	s.db.Exec(`DELETE FROM roles WHERE name LIKE 'approver-%'`)
}

// ========== Role ==========
func (s *DBStore) CreateRole(r *model.Role) error { return s.db.Create(r).Error }
func (s *DBStore) ListRoles() ([]model.Role, error) {
	var roles []model.Role
	err := s.db.Preload("Permissions").Find(&roles).Error
	return roles, err
}
func (s *DBStore) GetRole(id uint) (*model.Role, error) {
	var r model.Role
	err := s.db.Preload("Permissions").First(&r, id).Error
	if err != nil {
		return nil, err
	}
	return &r, nil
}
func (s *DBStore) GetRoleByName(name string) (*model.Role, error) {
	var r model.Role
	err := s.db.Where("name = ?", name).Preload("Permissions").First(&r).Error
	if err != nil {
		return nil, err
	}
	return &r, nil
}
func (s *DBStore) SetRolePermissions(roleID uint, perms []model.Permission) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("role_id = ?", roleID).Delete(&model.Permission{}).Error; err != nil {
			return err
		}
		for i := range perms {
			perms[i].RoleID = roleID
		}
		if len(perms) > 0 {
			return tx.Create(&perms).Error
		}
		return nil
	})
}

// ========== Release ==========
func (s *DBStore) CreateRelease(r *model.Release) error { return s.db.Create(r).Error }
func (s *DBStore) ListReleases(page, pageSize int, createdByID uint) ([]model.Release, int64, error) {
	var list []model.Release
	var total int64
	query := s.db.Model(&model.Release{})
	if createdByID > 0 {
		query = query.Where("created_by_id = ?", createdByID)
	}
	query.Count(&total)
	offset := (page - 1) * pageSize
	err := query.Preload("Stages.ApprovedBy").Preload("CreatedBy").Preload("Blueprint").Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&list).Error
	return list, total, err
}
func (s *DBStore) GetReleaseWithStages(id uint) (*model.Release, error) {
	var r model.Release
	err := s.db.Preload("Stages.ApprovedBy").Preload("CreatedBy").Preload("Blueprint").First(&r, id).Error
	if err != nil {
		return nil, err
	}
	return &r, nil
}
func (s *DBStore) CreateReleaseStage(stage *model.ReleaseStage) error {
	return s.db.Create(stage).Error
}
func (s *DBStore) GetStagesByStatus(status string) ([]model.ReleaseStage, error) {
	var stages []model.ReleaseStage
	err := s.db.Where("status = ?", status).Preload("ApprovedBy").Preload("Release").Find(&stages).Error
	return stages, err
}

// ========== Blueprint ==========
func (s *DBStore) CreateBlueprint(bp *model.PromotionBlueprint) error { return s.db.Create(bp).Error }
func (s *DBStore) UpdateBlueprint(bp *model.PromotionBlueprint) error { return s.db.Save(bp).Error }
func (s *DBStore) GetBlueprint(id uint) (*model.PromotionBlueprint, error) {
	var bp model.PromotionBlueprint
	if err := s.db.First(&bp, id).Error; err != nil {
		return nil, err
	}
	return &bp, nil
}
func (s *DBStore) ListBlueprints() ([]model.PromotionBlueprint, error) {
	var bps []model.PromotionBlueprint
	err := s.db.Find(&bps).Error
	return bps, err
}
func (s *DBStore) DeleteBlueprint(id uint) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("blueprint_id = ?", id).Delete(&model.BlueprintEdge{}).Error; err != nil {
			return err
		}
		if err := tx.Where("blueprint_id = ?", id).Delete(&model.BlueprintNode{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&model.PromotionBlueprint{}, id).Error; err != nil {
			return err
		}
		return nil
	})
}

// Node operations
func (s *DBStore) CreateNode(node *model.BlueprintNode) error {
	return s.db.Create(node).Error
}
func (s *DBStore) DeleteNodesByBlueprint(bpID uint) error {
	return s.db.Where("blueprint_id = ?", bpID).Delete(&model.BlueprintNode{}).Error
}
func (s *DBStore) GetBlueprintNodes(bpID uint) ([]model.BlueprintNode, error) {
	var nodes []model.BlueprintNode
	err := s.db.Where("blueprint_id = ?", bpID).Find(&nodes).Error
	return nodes, err
}

// Edge operations
func (s *DBStore) CreateEdges(edges []model.BlueprintEdge) error {
	if len(edges) == 0 {
		return nil
	}
	return s.db.Create(&edges).Error
}
func (s *DBStore) DeleteEdgesByBlueprint(bpID uint) error {
	return s.db.Where("blueprint_id = ?", bpID).Delete(&model.BlueprintEdge{}).Error
}
func (s *DBStore) GetBlueprintEdges(bpID uint) ([]model.BlueprintEdge, error) {
	var edges []model.BlueprintEdge
	err := s.db.Where("blueprint_id = ?", bpID).Find(&edges).Error
	return edges, err
}
