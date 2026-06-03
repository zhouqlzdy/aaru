package service

import (
	"encoding/json"
	"fmt"
	"time"

	"aaru/internal/model"
	"github.com/go-resty/resty/v2"
	"github.com/golang-jwt/jwt/v5"
)

type AuthService struct {
	jwtSecret    []byte
	gitlabURL    string
	gitlabAppID  string
	gitlabSecret string
	callbackURL  string
}

func NewAuthService(secret string) *AuthService {
	return &AuthService{jwtSecret: []byte(secret)}
}

func (a *AuthService) ConfigureGitlab(url, appID, secret, callbackURL string) {
	a.gitlabURL = url
	a.gitlabAppID = appID
	a.gitlabSecret = secret
	a.callbackURL = callbackURL
}

func (a *AuthService) IsGitlabConfigured() bool {
	return a.gitlabAppID != "" && a.gitlabSecret != ""
}

// GitlabAuthURL 返回 GitLab OAuth 授权地址
func (a *AuthService) GitlabAuthURL() string {
	return fmt.Sprintf("%s/oauth/authorize?client_id=%s&redirect_uri=%s&response_type=code&scope=read_user",
		a.gitlabURL, a.gitlabAppID, a.callbackURL)
}

type GitlabUser struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Avatar   string `json:"avatar_url"`
}

// ExchangeCode 用授权码换取 access token 并获取用户信息
func (a *AuthService) ExchangeCode(code string) (*GitlabUser, error) {
	client := resty.New()

	// 1. 用 code 换 token
	var tokenResp struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
	}
	resp, err := client.R().
		SetFormData(map[string]string{
			"client_id":     a.gitlabAppID,
			"client_secret": a.gitlabSecret,
			"code":          code,
			"grant_type":    "authorization_code",
			"redirect_uri":  a.callbackURL,
		}).
		SetResult(&tokenResp).
		Post(a.gitlabURL + "/oauth/token")
	if err != nil {
		return nil, fmt.Errorf("exchange code: %w", err)
	}
	if resp.IsError() {
		return nil, fmt.Errorf("exchange code: status %d", resp.StatusCode())
	}
	if tokenResp.AccessToken == "" {
		return nil, fmt.Errorf("no access token in response")
	}

	// 2. 用 token 获取用户信息
	var gitlabUser GitlabUser
	resp, err = client.R().
		SetHeader("Authorization", "Bearer "+tokenResp.AccessToken).
		SetResult(&gitlabUser).
		Get(a.gitlabURL + "/api/v4/user")
	if err != nil {
		return nil, fmt.Errorf("get user info: %w", err)
	}
	if resp.IsError() {
		return nil, fmt.Errorf("get user info: status %d", resp.StatusCode())
	}
	if gitlabUser.Username == "" {
		// 尝试解析原始响应
		var raw map[string]interface{}
		json.Unmarshal(resp.Body(), &raw)
		return nil, fmt.Errorf("empty username in gitlab response: %s", string(resp.Body()))
	}
	return &gitlabUser, nil
}

// GenerateToken 生成JWT token
func (a *AuthService) GenerateToken(user *model.User) (string, error) {
	claims := jwt.MapClaims{
		"user_id":  user.ID,
		"username": user.Username,
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
		"iat":      time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(a.jwtSecret)
}

// ParseToken 解析JWT token
func (a *AuthService) ParseToken(tokenStr string) (uint, string, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return a.jwtSecret, nil
	})
	if err != nil {
		return 0, "", err
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return 0, "", fmt.Errorf("invalid token")
	}
	userID := uint(claims["user_id"].(float64))
	username := claims["username"].(string)
	return userID, username, nil
}

// MockGitlabLogin 模拟Gitlab SSO登录
// 在一个真实系统中，这里会重定向到Gitlab进行OAuth认证
// 在mock模式下，直接根据用户名创建/查找用户
func (a *AuthService) MockGitlabLogin(username string, users []string) bool {
	for _, u := range users {
		if u == username {
			return true
		}
	}
	return false
}
