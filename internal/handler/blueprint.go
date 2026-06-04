package handler

import (
	"net/http"

	"aaru/internal/model"
	"aaru/internal/service"
	"aaru/internal/store"
	"github.com/gin-gonic/gin"
)

type BlueprintHandler struct {
	bpService *service.BlueprintService
	store     *store.DBStore
}

func NewBlueprintHandler(bp *service.BlueprintService, s *store.DBStore) *BlueprintHandler {
	return &BlueprintHandler{bpService: bp, store: s}
}

func (h *BlueprintHandler) requireAdmin(c *gin.Context) bool {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return false
	}
	user, err := h.store.GetUserWithRoles(userID.(uint))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return false
	}
	for _, role := range user.Roles {
		if role.Name == "admin" {
			return true
		}
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
	return false
}

func (h *BlueprintHandler) fullResponse(bpID uint) gin.H {
	bp, err := h.store.GetBlueprint(bpID)
	if err != nil {
		return gin.H{"error": err.Error()}
	}
	nodes, _ := h.store.GetBlueprintNodes(bpID)
	edges, _ := h.store.GetBlueprintEdges(bpID)
	if nodes == nil {
		nodes = []model.BlueprintNode{}
	}
	if edges == nil {
		edges = []model.BlueprintEdge{}
	}
	for i := range nodes {
		if nodes[i].ApproveRoleID != nil {
			role, err := h.store.GetRole(*nodes[i].ApproveRoleID)
			if err == nil {
				nodes[i].ApproveRole = role
			}
		}
	}
	return gin.H{
		"id": bp.ID, "name": bp.Name, "description": bp.Description,
		"nodes": nodes, "edges": edges,
		"webhook_base_url": "http://localhost:8080/api/hooks/promote",
		"created_at":       bp.CreatedAt, "updated_at": bp.UpdatedAt,
	}
}

func (h *BlueprintHandler) List(c *gin.Context) {
	bps, err := h.bpService.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"blueprints": bps})
}

func (h *BlueprintHandler) Get(c *gin.Context) {
	id, ok := parseID(c, "id")
	if !ok {
		return
	}
	c.JSON(http.StatusOK, h.fullResponse(id))
}

func (h *BlueprintHandler) Create(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	var in service.BlueprintInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	bp, err := h.bpService.Create(&in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, h.fullResponse(bp.ID))
}

func (h *BlueprintHandler) Update(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	id, ok := parseID(c, "id")
	if !ok {
		return
	}
	var in service.BlueprintInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	_, err := h.bpService.Update(id, &in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, h.fullResponse(id))
}

func (h *BlueprintHandler) Delete(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	id, ok := parseID(c, "id")
	if !ok {
		return
	}
	if err := h.bpService.Delete(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}
