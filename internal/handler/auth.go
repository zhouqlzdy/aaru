package handler

import (
	"net/http"

	"aaru/internal/model"
	"aaru/internal/service"
	"aaru/internal/store"
	"github.com/gin-gonic/gin"
)

type AuthHandler struct {
	authService *service.AuthService
	store       *store.DBStore
	mockUsers   []string
}

func NewAuthHandler(authService *service.AuthService, store *store.DBStore, mockUsers []string) *AuthHandler {
	return &AuthHandler{
		authService: authService,
		store:       store,
		mockUsers:   mockUsers,
	}
}

// MockLogin 模拟Gitlab SSO登录页面
func (h *AuthHandler) MockLogin(c *gin.Context) {
	c.HTML(http.StatusOK, "login.html", gin.H{
		"Users":            h.mockUsers,
		"GitlabEnabled":    h.authService.IsGitlabConfigured(),
		"GitlabAuthURL":    h.authService.GitlabAuthURL(),
	})
}

// MockCallback 模拟Gitlab SSO回调
func (h *AuthHandler) MockCallback(c *gin.Context) {
	username := c.PostForm("username")
	if username == "" {
		username = c.Query("username")
	}
	if username == "" {
		c.Redirect(http.StatusFound, "/auth/login")
		return
	}

	if !h.authService.MockGitlabLogin(username, h.mockUsers) {
		c.HTML(http.StatusUnauthorized, "login.html", gin.H{
			"Users":   h.mockUsers,
			"Error":   "无效的用户名",
			"Message": "请选择有效的用户登录",
		})
		return
	}

	// 查找或创建用户
	user, err := h.store.GetUserByUsername(username)
	if err != nil {
		// 创建新用户（用用户名生成唯一 GitLabID）
		var hash int64
		for _, c := range username {
			hash = hash*31 + int64(c)
		}
		if hash < 0 {
			hash = -hash
		}
		user = &model.User{
			Username:  username,
			Email:     username + "@example.com",
			GitlabID:  hash,
			AvatarURL: "",
		}
		if err := h.store.CreateUser(user); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "create user failed"})
			return
		}
		// 新用户默认分配 viewer 角色
		if viewerRole, err := h.store.GetRoleByName("viewer"); err == nil {
			h.store.SetUserRoles(user.ID, []uint{viewerRole.ID})
		}
	}

	token, err := h.authService.GenerateToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "generate token failed"})
		return
	}

	// 设置cookie
	c.SetCookie("token", token, 86400, "/", "", false, true)
	c.Redirect(http.StatusFound, "/")
}

// CurrentUser 获取当前登录用户信息
func (h *AuthHandler) CurrentUser(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not logged in"})
		return
	}
	user, err := h.store.GetUserWithRoles(userID.(uint))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, user)
}

// Logout 退出登录
func (h *AuthHandler) Logout(c *gin.Context) {
	c.SetCookie("token", "", -1, "/", "", false, true)
	c.Redirect(http.StatusFound, "/auth/login")
}

// GitlabCallback GitLab OAuth2 回调
func (h *AuthHandler) GitlabCallback(c *gin.Context) {
	// GitLab 可能返回 error 参数（如用户拒绝授权）
	if errMsg := c.Query("error"); errMsg != "" {
		c.HTML(http.StatusUnauthorized, "login.html", gin.H{
			"Error":          "GitLab授权失败: " + errMsg,
			"GitlabEnabled":  h.authService.IsGitlabConfigured(),
			"GitlabAuthURL":  h.authService.GitlabAuthURL(),
		})
		return
	}
	code := c.Query("code")
	if code == "" {
		c.HTML(http.StatusBadRequest, "login.html", gin.H{
			"Error":          "授权码缺失",
			"GitlabEnabled":  h.authService.IsGitlabConfigured(),
			"GitlabAuthURL":  h.authService.GitlabAuthURL(),
		})
		return
	}

	// 用 code 换取 GitLab 用户信息
	gitlabUser, err := h.authService.ExchangeCode(code)
	if err != nil {
		c.HTML(http.StatusUnauthorized, "login.html", gin.H{
			"Error":          "GitLab认证失败: " + err.Error(),
			"GitlabEnabled":  h.authService.IsGitlabConfigured(),
			"GitlabAuthURL":  h.authService.GitlabAuthURL(),
		})
		return
	}

	// 用 GitLab username 查找或创建 Aaru 用户
	email := gitlabUser.Email
	if email == "" {
		email = gitlabUser.Username + "@gitlab.local"
	}
	user := &model.User{
		Username:  gitlabUser.Username,
		Email:     email,
		GitlabID:  gitlabUser.ID,
		AvatarURL: gitlabUser.Avatar,
	}
	isNew, err := h.store.FindOrCreateUser(user)
	if err != nil {
		c.HTML(http.StatusInternalServerError, "login.html", gin.H{
			"Error":          "创建用户失败: " + err.Error(),
			"GitlabEnabled":  h.authService.IsGitlabConfigured(),
			"GitlabAuthURL":  h.authService.GitlabAuthURL(),
		})
		return
	}
	if isNew {
		// 新用户默认分配 viewer 角色
		if viewerRole, err := h.store.GetRoleByName("viewer"); err == nil {
			h.store.SetUserRoles(user.ID, []uint{viewerRole.ID})
		}
	} else {
		// 已有用户，更新 GitLab 信息
		if user.GitlabID == 0 {
			user.GitlabID = gitlabUser.ID
		}
		if gitlabUser.Avatar != "" {
			user.AvatarURL = gitlabUser.Avatar
		}
		h.store.DB().Save(user)
	}

	token, err := h.authService.GenerateToken(user)
	if err != nil {
		c.HTML(http.StatusInternalServerError, "login.html", gin.H{
			"Error":          "生成token失败",
			"GitlabEnabled":  h.authService.IsGitlabConfigured(),
			"GitlabAuthURL":  h.authService.GitlabAuthURL(),
		})
		return
	}

	c.SetCookie("token", token, 86400, "/", "", false, true)
	c.Redirect(http.StatusFound, "/")
}
