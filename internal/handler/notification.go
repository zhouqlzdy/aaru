package handler

import (
	"net/http"

	"aaru/internal/model"
	"aaru/internal/service"
	"aaru/internal/store"
	"github.com/gin-gonic/gin"
)

type NotificationHandler struct {
	notifSvc *service.NotificationService
	store    *store.DBStore
}

func NewNotificationHandler(n *service.NotificationService, s *store.DBStore) *NotificationHandler {
	return &NotificationHandler{notifSvc: n, store: s}
}

func (h *NotificationHandler) GetConfig(c *gin.Context) {
	if !requireAdmin(c, h.store) {
		return
	}
	cfg, err := h.notifSvc.GetConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

func (h *NotificationHandler) SaveConfig(c *gin.Context) {
	if !requireAdmin(c, h.store) {
		return
	}
	var cfg model.NotificationConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.notifSvc.SaveConfig(&cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}
