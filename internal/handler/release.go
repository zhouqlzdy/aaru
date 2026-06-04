package handler

import (
	"net/http"
	"strconv"

	"aaru/internal/service"
	"github.com/gin-gonic/gin"
)

type ReleaseHandler struct {
	releaseService *service.ReleaseService
}

func NewReleaseHandler(rs *service.ReleaseService) *ReleaseHandler {
	return &ReleaseHandler{releaseService: rs}
}

type CreateReleaseRequest struct {
	Title          string                 `json:"title" binding:"required"`
	DeployUnitCode string                 `json:"deploy_unit_code" binding:"required"`
	BlueprintID    uint                   `json:"blueprint_id" binding:"required"`
	Changes        map[string]interface{} `json:"changes"`
}

func (h *ReleaseHandler) CreateRelease(c *gin.Context) {
	var req CreateReleaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.BlueprintID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "blueprint_id is required"})
		return
	}
	userID := c.GetUint("user_id")
	release, err := h.releaseService.CreateRelease(
		req.Title, req.DeployUnitCode, userID,
		req.BlueprintID, req.Changes,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, release)
}

type BatchCreateReleaseRequest struct {
	Title       string   `json:"title" binding:"required"`
	DUCodes     []string `json:"du_codes" binding:"required"`
	BlueprintID uint     `json:"blueprint_id" binding:"required"`
	Version     string   `json:"version" binding:"required"`
}

func (h *ReleaseHandler) BatchCreateRelease(c *gin.Context) {
	var req BatchCreateReleaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.BlueprintID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "blueprint_id is required"})
		return
	}
	userID := c.GetUint("user_id")
	releases, err := h.releaseService.BatchCreateRelease(
		req.Title, req.DUCodes, userID,
		req.BlueprintID, req.Version,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"releases": releases, "count": len(releases)})
}

func (h *ReleaseHandler) ListReleases(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	userID := c.GetUint("user_id")
	releases, total, err := h.releaseService.ListReleases(page, pageSize, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"releases": releases, "total": total, "page": page})
}

func (h *ReleaseHandler) GetRelease(c *gin.Context) {
	id, ok := parseID(c, "id")
	if !ok {
		return
	}
	release, err := h.releaseService.GetRelease(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "release not found"})
		return
	}
	c.JSON(http.StatusOK, release)
}

func (h *ReleaseHandler) StartRelease(c *gin.Context) {
	id, ok := parseID(c, "id")
	if !ok {
		return
	}
	userID := c.GetUint("user_id")
	release, err := h.releaseService.StartRelease(id, userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, release)
}

func (h *ReleaseHandler) ApproveStage(c *gin.Context) {
	stageID, ok := parseID(c, "stageId")
	if !ok {
		return
	}
	var req struct {
		Comment string `json:"comment"`
	}
	c.ShouldBindJSON(&req)
	userID := c.GetUint("user_id")
	release, err := h.releaseService.ApproveStage(stageID, userID, req.Comment)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, release)
}

func (h *ReleaseHandler) RejectStage(c *gin.Context) {
	stageID, ok := parseID(c, "stageId")
	if !ok {
		return
	}
	var req struct {
		Comment string `json:"comment"`
	}
	c.ShouldBindJSON(&req)
	userID := c.GetUint("user_id")
	release, err := h.releaseService.RejectStage(stageID, userID, req.Comment)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, release)
}

func (h *ReleaseHandler) RollbackRelease(c *gin.Context) {
	id, ok := parseID(c, "id")
	if !ok {
		return
	}
	userID := c.GetUint("user_id")
	release, err := h.releaseService.RollbackRelease(id, userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, release)
}

func (h *ReleaseHandler) PromoteToNext(c *gin.Context) {
	stageID, ok := parseID(c, "stageId")
	if !ok {
		return
	}
	userID := c.GetUint("user_id")
	release, err := h.releaseService.PromoteToNext(stageID, userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, release)
}

func (h *ReleaseHandler) PendingApprovals(c *gin.Context) {
	userID := c.GetUint("user_id")
	stages, err := h.releaseService.GetPendingApprovals(userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"stages": stages})
}

// WebhookPromote 外部系统通过webhook触发自动晋级
func (h *ReleaseHandler) WebhookPromote(c *gin.Context) {
	token := c.Query("token")
	stageID, ok := parseID(c, "stageId")
	if !ok || token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	release, err := h.releaseService.WebhookPromote(stageID, token)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, release)
}

// RetryPush 重试停留在 pushing 状态的 stage
func (h *ReleaseHandler) RetryPush(c *gin.Context) {
	stageID, ok := parseID(c, "stageId")
	if !ok {
		return
	}
	userID := c.GetUint("user_id")
	release, err := h.releaseService.RetryPush(stageID, userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, release)
}
