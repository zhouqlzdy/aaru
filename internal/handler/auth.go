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

	user, err := h.loginOrCreateUser(c, username, username+"@example.com", 0, "")
	if err != nil || user == nil {
		return
	}

	token, err := h.authService.GenerateToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "generate token failed"})
		return
	}

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

// loginOrCreateUser 统一的登录/创建用户逻辑。
// 已有用户保留原有角色和权限；新用户自动分配 viewer 角色。
// 成功返回 user，失败写入 HTTP 响应并返回 nil。
func (h *AuthHandler) loginOrCreateUser(c *gin.Context, username, email string, gitlabID int64, avatar string) (*model.User, error) {
	newUser := &model.User{
		Username:  username,
		Email:     email,
		GitlabID:  gitlabID,
		AvatarURL: avatar,
	}
	user, isNew, err := h.store.FindOrCreateUser(newUser)
	if err != nil {
		c.HTML(http.StatusInternalServerError, "login.html", gin.H{
			"Error":         "用户创建失败: " + err.Error(),
			"GitlabEnabled": h.authService.IsGitlabConfigured(),
			"GitlabAuthURL": h.authService.GitlabAuthURL(),
		})
		return nil, err
	}

	if isNew {
		// 新用户默认分配 viewer 角色
		if viewerRole, err := h.store.GetRoleByName("viewer"); err == nil {
			h.store.SetUserRoles(user.ID, []uint{viewerRole.ID})
		}
		user, _ = h.store.GetUserByUsername(user.Username)
	} else {
		// 已有用户：更新 GitLab 信息（GitlabID、Avatar、Email）
		h.updateGitlabInfo(user, gitlabID, avatar, email)
	}
	return user, nil
}

// updateGitlabInfo 更新已有用户的 GitLab 关联信息。
func (h *AuthHandler) updateGitlabInfo(user *model.User, gitlabID int64, avatar, email string) {
	changed := false
	if gitlabID != 0 && user.GitlabID != gitlabID {
		user.GitlabID = gitlabID
		changed = true
	}
	if avatar != "" && user.AvatarURL != avatar {
		user.AvatarURL = avatar
		changed = true
	}
	if email != "" && user.Email != email {
		user.Email = email
		changed = true
	}
	if changed {
		h.store.DB().Save(user)
	}
}

// GitlabCallback GitLab OAuth2 回调
func (h *AuthHandler) GitlabCallback(c *gin.Context) {
	if errMsg := c.Query("error"); errMsg != "" {
		c.HTML(http.StatusUnauthorized, "login.html", gin.H{
			"Error":         "GitLab授权失败: " + errMsg,
			"GitlabEnabled": h.authService.IsGitlabConfigured(),
			"GitlabAuthURL": h.authService.GitlabAuthURL(),
		})
		return
	}
	code := c.Query("code")
	if code == "" {
		c.HTML(http.StatusBadRequest, "login.html", gin.H{
			"Error":         "授权码缺失",
			"GitlabEnabled": h.authService.IsGitlabConfigured(),
			"GitlabAuthURL": h.authService.GitlabAuthURL(),
		})
		return
	}

	gitlabUser, err := h.authService.ExchangeCode(code)
	if err != nil {
		c.HTML(http.StatusUnauthorized, "login.html", gin.H{
			"Error":         "GitLab认证失败: " + err.Error(),
			"GitlabEnabled": h.authService.IsGitlabConfigured(),
			"GitlabAuthURL": h.authService.GitlabAuthURL(),
		})
		return
	}

	email := gitlabUser.Email
	if email == "" {
		email = gitlabUser.Username + "@gitlab.local"
	}

	user, err := h.loginOrCreateUser(c, gitlabUser.Username, email, gitlabUser.ID, gitlabUser.Avatar)
	if err != nil || user == nil {
		return
	}

	token, err := h.authService.GenerateToken(user)
	if err != nil {
		c.HTML(http.StatusInternalServerError, "login.html", gin.H{
			"Error":         "生成token失败",
			"GitlabEnabled": h.authService.IsGitlabConfigured(),
			"GitlabAuthURL": h.authService.GitlabAuthURL(),
		})
		return
	}

	c.SetCookie("token", token, 86400, "/", "", false, true)
	c.Redirect(http.StatusFound, "/")
}
