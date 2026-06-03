package handler

import (
	"strings"

	"aaru/internal/middleware"
	"aaru/internal/service"
	"aaru/internal/store"
	"github.com/gin-gonic/gin"
)

func upperFirst(s string) string {
	if s == "" {
		return ""
	}
	return strings.ToUpper(string(s[0]))
}

func RegisterRoutes(
	r *gin.Engine,
	store *store.DBStore,
	authService *service.AuthService,
	dmdbClient *service.DMDBClient,
	releaseService *service.ReleaseService,
	bpService *service.BlueprintService,
	mockUsers []string,
) {
	authMiddleware := middleware.NewAuthMiddleware(authService)
	authHandler := NewAuthHandler(authService, store, mockUsers)
	dmdbHandler := NewDMDBHandler(dmdbClient)
	releaseHandler := NewReleaseHandler(releaseService)
	adminHandler := NewAdminHandler(store)
	bpHandler := NewBlueprintHandler(bpService, store)

	r.SetFuncMap(map[string]interface{}{
		"upperFirst": upperFirst,
	})
	r.LoadHTMLGlob("web/templates/*")

	// 静态文件禁用缓存（开发环境）
	r.Static("/static", "web")
	r.Use(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/static/") {
			c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
			c.Header("Pragma", "no-cache")
			c.Header("Expires", "0")
		}
		c.Next()
	})

	r.GET("/auth/login", authHandler.MockLogin)
	r.POST("/auth/login", authHandler.MockCallback)
	r.GET("/auth/callback", authHandler.MockCallback)
	r.POST("/auth/callback", authHandler.MockCallback)

	r.GET("/api/hooks/promote/:stageId", releaseHandler.WebhookPromote)
	r.POST("/api/hooks/promote/:stageId", releaseHandler.WebhookPromote)

	api := r.Group("/api")
	api.Use(authMiddleware.RequireAuth())
	{
		api.GET("/current-user", authHandler.CurrentUser)
		api.POST("/logout", authHandler.Logout)

		// DMDB数据
		api.GET("/environments", dmdbHandler.ListEnvironments)
		api.GET("/silos", dmdbHandler.ListSilos)
		api.GET("/systems", dmdbHandler.ListSystems)
		api.GET("/deploy-units", dmdbHandler.QueryDeployUnits)
		api.GET("/deploy-units/:code", dmdbHandler.GetDeployUnit)
		api.GET("/deploy-units/:code/compare", dmdbHandler.CompareDUConfig)
		api.GET("/du-list", dmdbHandler.ListAllDUs)

		// 发布单
		api.POST("/releases", releaseHandler.CreateRelease)
		api.GET("/releases", releaseHandler.ListReleases)
		api.GET("/releases/:id", releaseHandler.GetRelease)
		api.POST("/releases/:id/start", releaseHandler.StartRelease)
		api.POST("/releases/:id/rollback", releaseHandler.RollbackRelease)

		// 发布阶段
		api.POST("/stages/:stageId/approve", releaseHandler.ApproveStage)
		api.POST("/stages/:stageId/reject", releaseHandler.RejectStage)
		api.POST("/stages/:stageId/promote", releaseHandler.PromoteToNext)
		api.POST("/stages/:stageId/retry-push", releaseHandler.RetryPush)

		// 审批
		api.GET("/approvals/pending", releaseHandler.PendingApprovals)

		// 晋级蓝图
		api.GET("/blueprints", bpHandler.List)
		api.POST("/blueprints", bpHandler.Create)
		api.GET("/blueprints/:id", bpHandler.Get)
		api.PUT("/blueprints/:id", bpHandler.Update)
		api.DELETE("/blueprints/:id", bpHandler.Delete)

		// 管理员
		api.GET("/admin/users", adminHandler.ListUsers)
		api.GET("/admin/roles", adminHandler.ListRoles)
		api.GET("/admin/roles/:roleId", adminHandler.GetRole)
		api.POST("/admin/roles", adminHandler.CreateRole)
		api.PUT("/admin/users/:userId/roles", adminHandler.SetUserRoles)
		api.PUT("/admin/roles/:roleId/permissions", adminHandler.SetRolePermissions)
	}

	r.GET("/", func(c *gin.Context) {
		c.HTML(200, "index.html", nil)
	})
}
