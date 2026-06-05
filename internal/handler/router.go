package handler

import (
	"html/template"
	"io/fs"
	"net/http"
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
	webFS fs.FS,
) {
	authMiddleware := middleware.NewAuthMiddleware(authService)
	authHandler := NewAuthHandler(authService, store, mockUsers)
	dmdbHandler := NewDMDBHandler(dmdbClient)
	releaseHandler := NewReleaseHandler(releaseService)
	adminHandler := NewAdminHandler(store, authService)
	bpHandler := NewBlueprintHandler(bpService, store)

	// 模板：从 embed.FS 加载
	tmpl := template.Must(template.New("").Funcs(template.FuncMap{
		"upperFirst": upperFirst,
	}).ParseFS(webFS, "web/templates/*.html"))
	r.SetHTMLTemplate(tmpl)

	// 静态文件：从 embed.FS 提供，禁用缓存
	webSub, _ := fs.Sub(webFS, "web")
	staticFS := http.StripPrefix("/static/", http.FileServer(http.FS(webSub)))
	r.Use(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/static/") {
			c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
			c.Header("Pragma", "no-cache")
			c.Header("Expires", "0")
			staticFS.ServeHTTP(c.Writer, c.Request)
			c.Abort()
			return
		}
		c.Next()
	})

	r.POST("/api/init", adminHandler.InitSystem) // 公开接口，仅无用户时可用
	r.GET("/auth/login", authHandler.MockLogin)
	r.POST("/auth/login", authHandler.MockCallback)
	r.GET("/auth/callback", authHandler.MockCallback)
	r.POST("/auth/callback", authHandler.MockCallback)
	r.GET("/auth/gitlab/callback", authHandler.GitlabCallback)

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
		api.POST("/batch-releases", releaseHandler.BatchCreateRelease)
		api.GET("/releases", releaseHandler.ListReleases)
		api.GET("/releases/:id", releaseHandler.GetRelease)
		api.POST("/releases/:id/start", releaseHandler.StartRelease)
		api.POST("/releases/:id/rollback", releaseHandler.RollbackRelease)
		api.POST("/releases/:id/deprecate", releaseHandler.DeprecateRelease)
		api.DELETE("/releases/:id", releaseHandler.DeleteRelease)

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
		api.POST("/admin/users/batch", adminHandler.BatchCreateUsers)
		api.GET("/admin/users", adminHandler.ListUsers)
		api.GET("/admin/roles", adminHandler.ListRoles)
		api.GET("/admin/roles/:roleId", adminHandler.GetRole)
		api.POST("/admin/roles", adminHandler.CreateRole)
		api.PUT("/admin/users/:userId/roles", adminHandler.SetUserRoles)
		api.PUT("/admin/users/:userId/access", adminHandler.UpdateUserAccess)
		api.PUT("/admin/roles/:roleId/permissions", adminHandler.SetRolePermissions)
	}

	r.GET("/", func(c *gin.Context) {
		c.HTML(200, "index.html", nil)
	})
}
