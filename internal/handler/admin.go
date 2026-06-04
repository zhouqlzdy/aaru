package handler

import (
	"net/http"
	"strconv"

	"aaru/internal/model"
	"aaru/internal/service"
	"aaru/internal/store"
	"github.com/gin-gonic/gin"
)

type AdminHandler struct {
	store       *store.DBStore
	authService *service.AuthService
}

func NewAdminHandler(s *store.DBStore, auth *service.AuthService) *AdminHandler {
	return &AdminHandler{store: s, authService: auth}
}

// InitSystem 初始化系统（仅在无用户时可用）
func (h *AdminHandler) InitSystem(c *gin.Context) {
	// 检查是否已有用户
	users, _ := h.store.ListUsers()
	if len(users) > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "系统已初始化，无法重复操作"})
		return
	}

	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password"` // 预留，当前未使用
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 创建 admin 用户
	user := &model.User{
		Username:     req.Username,
		Email:        req.Username + "@admin.local",
		AllowedSilos: "*",
		AllowedEnvs:  "*",
	}
	if err := h.store.CreateUser(user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建用户失败: " + err.Error()})
		return
	}

	// 分配 admin 角色
	roles, _ := h.store.ListRoles()
	for _, role := range roles {
		if role.Name == "admin" {
			h.store.SetUserRoles(user.ID, []uint{role.ID})
			break
		}
	}

	// 生成 token
	token, err := h.authService.GenerateToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成token失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "系统初始化成功",
		"username": user.Username,
		"user_id":  user.ID,
		"token":    token,
	})
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

// BatchCreateUsers 批量预创建用户（SSO登录时自动关联）
func (h *AdminHandler) BatchCreateUsers(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	var req struct {
		Users []struct {
			Username     string `json:"username"`
			Email        string `json:"email"`
			Role         string `json:"role"`          // admin/developer/operator/viewer
			AllowedSilos string `json:"allowed_silos"`  // "" / "*" / "silo1,silo2"
			AllowedEnvs  string `json:"allowed_envs"`   // "" / "*" / "env1,env2"
		} `json:"users"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 预加载角色映射
	roles, _ := h.store.ListRoles()
	roleMap := make(map[string]uint)
	for _, r := range roles {
		roleMap[r.Name] = r.ID
	}

	var created, skipped []string
	for _, u := range req.Users {
		if u.Username == "" {
			continue
		}
		// 已存在则跳过
		if _, err := h.store.GetUserByUsername(u.Username); err == nil {
			skipped = append(skipped, u.Username)
			continue
		}
		user := &model.User{
			Username:     u.Username,
			Email:        u.Email,
			AllowedSilos: u.AllowedSilos,
			AllowedEnvs:  u.AllowedEnvs,
		}
		if user.Email == "" {
			user.Email = u.Username + "@pending.local"
		}
		if user.AllowedSilos == "" {
			user.AllowedSilos = "*"
		}
		if err := h.store.CreateUser(user); err != nil {
			continue
		}
		// 分配角色
		if roleID, ok := roleMap[u.Role]; ok {
			h.store.SetUserRoles(user.ID, []uint{roleID})
		}
		created = append(created, u.Username)
	}
	c.JSON(http.StatusOK, gin.H{"created": created, "skipped": skipped})
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
