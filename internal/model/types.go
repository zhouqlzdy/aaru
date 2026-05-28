package model

import "time"

type User struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Username  string    `gorm:"uniqueIndex;size:64" json:"username"`
	Email     string    `gorm:"size:128" json:"email"`
	AvatarURL string    `gorm:"size:256" json:"avatar_url"`
	GitlabID  int64     `gorm:"uniqueIndex" json:"gitlab_id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Roles     []Role    `gorm:"many2many:user_roles;" json:"roles,omitempty"`
}

type Role struct {
	ID          uint         `gorm:"primaryKey" json:"id"`
	Name        string       `gorm:"uniqueIndex;size:64" json:"name"`
	Description string       `gorm:"size:256" json:"description"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
	Users       []User       `gorm:"many2many:user_roles;" json:"-"`
	Permissions []Permission `json:"permissions,omitempty"`
}

type Permission struct {
	ID             uint   `gorm:"primaryKey" json:"id"`
	RoleID         uint   `gorm:"index" json:"role_id"`
	DeployUnitCode string `gorm:"size:128" json:"deploy_unit_code"`
	Action         string `gorm:"size:32" json:"action"`
}

type PromotionBlueprint struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"size:128;uniqueIndex" json:"name"`
	Description string    `gorm:"size:512" json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type BlueprintNode struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	BlueprintID   uint      `gorm:"index" json:"blueprint_id"`
	EnvCode       string    `gorm:"size:64" json:"env_code"`
	EnvName       string    `gorm:"size:128" json:"env_name"`
	PositionX     int       `json:"pos_x"`
	PositionY     int       `json:"pos_y"`
	GateType      string    `gorm:"size:32;default:manual" json:"gate_type"` // manual, api_hook
	ApproveRoleID *uint     `json:"approve_role_id,omitempty"`
	ApproveRole   *Role     `gorm:"foreignKey:ApproveRoleID" json:"approve_role,omitempty"`
	WebhookToken  string    `gorm:"size:64" json:"webhook_token,omitempty"` // 系统自动生成
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type BlueprintEdge struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	BlueprintID uint      `gorm:"index" json:"blueprint_id"`
	FromNodeID  uint      `gorm:"index" json:"from_node_id"`
	ToNodeID    uint      `gorm:"index" json:"to_node_id"`
	CreatedAt   time.Time `json:"created_at"`
}

type Release struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	Title          string         `gorm:"size:256" json:"title"`
	DeployUnitCode string         `gorm:"size:128;index" json:"deploy_unit_code"`
	DeployUnitName string         `gorm:"size:256" json:"deploy_unit_name"`
	SiloCode       string         `gorm:"size:128" json:"silo_code"`
	SiloName       string         `gorm:"size:256" json:"silo_name"`
	SystemName     string         `gorm:"size:256" json:"system_name"`
	Version        string         `gorm:"size:64" json:"version"`
	BlueprintID    *uint          `gorm:"index" json:"blueprint_id,omitempty"`
	Status         string         `gorm:"size:32;default:draft;index" json:"status"`
	CreatedByID    uint           `json:"created_by_id"`
	CreatedBy      User           `gorm:"foreignKey:CreatedByID" json:"created_by,omitempty"`
	Stages         []ReleaseStage `json:"stages,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type ReleaseStage struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	ReleaseID      uint       `gorm:"index" json:"release_id"`
	NodeID         *uint      `json:"node_id,omitempty"`
	EnvCode        string     `gorm:"size:64" json:"env_code"`
	EnvName        string     `gorm:"size:128" json:"env_name"`
	PromotionOrder int        `json:"promotion_order"`
		GateType       string     `gorm:"size:32;default:manual" json:"gate_type,omitempty"`

	Status         string     `gorm:"size:32;default:pending" json:"status"`
	ApprovedByID   *uint      `json:"approved_by_id,omitempty"`
	ApprovedBy     *User      `gorm:"foreignKey:ApprovedByID" json:"approved_by,omitempty"`
	ApprovedAt     *time.Time `json:"approved_at,omitempty"`
	Comment        string     `gorm:"size:512" json:"comment,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}
