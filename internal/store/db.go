package store

import (
	"fmt"
	"strings"
	"time"

	"aaru/internal/model"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

type DBStore struct{ db *gorm.DB }

func NewDBStore(dsn string) (*DBStore, error) {
	if dsn == "" {
		return nil, fmt.Errorf("mysql dsn is required")
	}

	// 确保 DSN 包含 parseTime=True，否则 time.Time 字段扫描会失败
	if !strings.Contains(dsn, "parseTime=") {
		if strings.Contains(dsn, "?") {
			dsn += "&parseTime=True"
		} else {
			dsn += "?parseTime=True"
		}
	}

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
		NamingStrategy: schema.NamingStrategy{
			TablePrefix: "aaru_",
		},
	})
	if err != nil {
		return nil, err
	}
	if err := db.AutoMigrate(
		&model.User{}, &model.Role{}, &model.Permission{},
		&model.Release{}, &model.ReleaseStage{},
		&model.PromotionBlueprint{}, &model.BlueprintNode{}, &model.BlueprintEdge{},
		&model.NotificationConfig{},
	); err != nil {
		return nil, err
	}
	return &DBStore{db: db}, nil
}

func (s *DBStore) DB() *gorm.DB { return s.db }

// ========== User ==========
func (s *DBStore) CreateUser(u *model.User) error { return s.db.Create(u).Error }

// FindOrCreateUser 按用户名查找（含角色），不存在则创建，返回用户和是否新建。
func (s *DBStore) FindOrCreateUser(newUser *model.User) (*model.User, bool, error) {
	existing, err := s.GetUserByUsername(newUser.Username)
	if err == nil {
		return existing, false, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, false, err
	}
	// 用户不存在，尝试创建
	newUser.ID = 0
	if err := s.db.Create(newUser).Error; err != nil {
		// 唯一键冲突 = 并发请求已创建，重新查找
		if isDuplicateKeyErr(err) {
			existing, err2 := s.GetUserByUsername(newUser.Username)
			if err2 != nil {
				return nil, false, err2
			}
			return existing, false, nil
		}
		return nil, false, err
	}
	return newUser, true, nil
}

// isDuplicateKeyErr 判断是否为 MySQL 唯一键冲突错误。
func isDuplicateKeyErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "Duplicate entry") || strings.Contains(msg, "1062")
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
	s.db.Exec(`UPDATE aaru_users SET allowed_silos = '*', allowed_envs = '*' WHERE (allowed_silos IS NULL OR allowed_silos = '') AND id IN (
		SELECT user_id FROM aaru_user_roles WHERE role_id IN (SELECT id FROM aaru_roles WHERE name = 'admin')
	)`)
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

func (s *DBStore) GetRelease(id uint) (*model.Release, error) {
	var r model.Release
	err := s.db.First(&r, id).Error
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
func (s *DBStore) GetApprovalHistoryByUser(userID uint) ([]model.ReleaseStage, error) {
	var stages []model.ReleaseStage
	err := s.db.Where("approved_by_id = ?", userID).Preload("ApprovedBy").Preload("Release").Order("approved_at DESC").Find(&stages).Error
	return stages, err
}
func (s *DBStore) GetActiveReleasesByBlueprint(bpID uint) ([]model.Release, error) {
	var releases []model.Release
	err := s.db.Where("blueprint_id = ? AND status IN (?)", bpID, []string{"draft", "in_progress"}).Find(&releases).Error
	return releases, err
}
func (s *DBStore) DeprecateReleasesByBlueprint(bpID uint) error {
	now := time.Now()
	return s.db.Transaction(func(tx *gorm.DB) error {
		// 将 in_progress/pending 的 stage 标记为 skipped
		if err := tx.Model(&model.ReleaseStage{}).
			Where("release_id IN (?) AND status IN (?)",
				tx.Model(&model.Release{}).Select("id").Where("blueprint_id = ? AND status = ?", bpID, "in_progress"),
				[]string{"in_progress", "pending"}).
			Updates(map[string]interface{}{"status": "skipped"}).Error; err != nil {
			return err
		}
		// 废弃 draft 和 in_progress 的发布
		return tx.Model(&model.Release{}).
			Where("blueprint_id = ? AND status IN (?)", bpID, []string{"draft", "in_progress"}).
			Updates(map[string]interface{}{"status": "deprecated", "deprecated_at": now}).Error
	})
}

func (s *DBStore) DeleteRelease(id uint) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("release_id = ?", id).Delete(&model.ReleaseStage{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.Release{}, id).Error
	})
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
		// 解除发布单对蓝图的引用
		if err := tx.Model(&model.Release{}).Where("blueprint_id = ?", id).Update("blueprint_id", nil).Error; err != nil {
			return err
		}
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
func (s *DBStore) SaveNode(node *model.BlueprintNode) error {
	return s.db.Save(node).Error
}
func (s *DBStore) DeleteNode(id uint) error {
	return s.db.Delete(&model.BlueprintNode{}, id).Error
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
func (s *DBStore) DeleteEdge(id uint) error {
	return s.db.Delete(&model.BlueprintEdge{}, id).Error
}
func (s *DBStore) GetBlueprintEdges(bpID uint) ([]model.BlueprintEdge, error) {
	var edges []model.BlueprintEdge
	err := s.db.Where("blueprint_id = ?", bpID).Find(&edges).Error
	return edges, err
}

// ========== Notification Config ==========
func (s *DBStore) GetNotificationConfig() (*model.NotificationConfig, error) {
	var cfg model.NotificationConfig
	err := s.db.First(&cfg).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			// 返回默认空配置
			return &model.NotificationConfig{EnvWebhooks: map[string]string{}}, nil
		}
		return nil, err
	}
	if cfg.EnvWebhooks == nil {
		cfg.EnvWebhooks = map[string]string{}
	}
	return &cfg, nil
}
func (s *DBStore) SaveNotificationConfig(cfg *model.NotificationConfig) error {
	if cfg.ID == 0 {
		cfg.ID = 1
	}
	return s.db.Save(cfg).Error
}
