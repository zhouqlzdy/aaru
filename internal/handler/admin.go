package handler

import (
	"net/http"
	"strconv"

	"aaru/internal/model"
	"aaru/internal/store"
	"github.com/gin-gonic/gin"
)

type AdminHandler struct {
	store *store.DBStore
}

func NewAdminHandler(s *store.DBStore) *AdminHandler {
	return &AdminHandler{store: s}
}

// requireAdmin 检查当前用户是否为 admin
func (h *AdminHandler) requireAdmin(c *gin.Context) bool {
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

// ListUsers 用户列表
func (h *AdminHandler) ListUsers(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	users, err := h.store.ListUsers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": users})
}

// ListRoles 角色列表
func (h *AdminHandler) ListRoles(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	roles, err := h.store.ListRoles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"roles": roles})
}

// CreateRole 创建角色
func (h *AdminHandler) CreateRole(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	var req struct {
		Name        string `json:"name" binding:"required"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	role := &model.Role{
		Name:        req.Name,
		Description: req.Description,
	}
	if err := h.store.CreateRole(role); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, role)
}

// SetUserRoles 设置用户角色
func (h *AdminHandler) SetUserRoles(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	userID, err := strconv.ParseUint(c.Param("userId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	var req struct {
		RoleIDs []uint `json:"role_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.SetUserRoles(uint(userID), req.RoleIDs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

// UpdateUserAccess 更新用户的可用竖井和环境
func (h *AdminHandler) UpdateUserAccess(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	userID, err := strconv.ParseUint(c.Param("userId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	var req struct {
		AllowedSilos string `json:"allowed_silos"`
		AllowedEnvs  string `json:"allowed_envs"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.UpdateUserAccess(uint(userID), req.AllowedSilos, req.AllowedEnvs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

// SetRolePermissions 设置角色权限
func (h *AdminHandler) SetRolePermissions(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	roleID, err := strconv.ParseUint(c.Param("roleId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}
	var req struct {
		Permissions []model.Permission `json:"permissions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.SetRolePermissions(uint(roleID), req.Permissions); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

// GetRole 获取角色详情
func (h *AdminHandler) GetRole(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	roleID, err := strconv.ParseUint(c.Param("roleId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role id"})
		return
	}
	role, err := h.store.GetRole(uint(roleID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}
	c.JSON(http.StatusOK, role)
}
