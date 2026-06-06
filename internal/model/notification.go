package model

import "time"

// NotificationConfig 机器人通知配置（单例，ID 固定为 1）
type NotificationConfig struct {
	ID             uint              `gorm:"primaryKey" json:"id"`
	AaruDomain     string            `gorm:"size:256" json:"aaru_domain"`      // e.g. "https://aaru.example.com"
	EnvWebhooks    map[string]string `gorm:"serializer:json" json:"env_webhooks"` // envCode → webhook URL
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
}
