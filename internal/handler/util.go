package handler

import (
	"net/http"
	"strconv"

	"aaru/internal/store"
	"github.com/gin-gonic/gin"
)

func parseID(c *gin.Context, param string) (uint, bool) {
	id, err := strconv.ParseUint(c.Param(param), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid " + param})
		return 0, false
	}
	return uint(id), true
}

// requireAdmin 检查当前用户是否为 admin
func requireAdmin(c *gin.Context, s *store.DBStore) bool {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return false
	}
	user, err := s.GetUserWithRoles(userID.(uint))
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
