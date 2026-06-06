package main

import (
	"errors"
	"log"
	"net/http"
	"time"

	"aaru"
	"aaru/internal/handler"
	"aaru/internal/model"
	"aaru/internal/service"
	"aaru/internal/store"
	"github.com/gin-gonic/gin"
)

func main() {
	config := model.LoadConfig()
	dbStore, err := store.NewDBStore(config.DSN)
	if err != nil {
		log.Fatalf("init db: %v", err)
	}

	authService := service.NewAuthService(config.JwtSecret)
	if config.Gitlab.AppID != "" {
		gitlabURL := config.Gitlab.URL
		if gitlabURL == "" {
			gitlabURL = "http://localhost"
		}
		authService.ConfigureGitlab(gitlabURL, config.Gitlab.AppID, config.Gitlab.AppSecret, config.Gitlab.CallbackURL)
		log.Printf("GitLab SSO enabled: %s", gitlabURL)
	}
	dmdbClient := service.NewDMDBClient(config.DMDB.ServerAddress, config.DevOps.ServerAddress, config.DMDB.Token)
	permService := service.NewPermissionService(dbStore)
	bpService := service.NewBlueprintService(dbStore)
	notifService := service.NewNotificationService(dbStore, permService)
	releaseService := service.NewReleaseService(dbStore, dmdbClient, permService, bpService)
	releaseService.SetNotificationService(notifService)

	initDefaults(dbStore)

	r := gin.Default()
	setupCORS(r)
	handler.RegisterRoutes(r, dbStore, authService, dmdbClient, releaseService, bpService, notifService, config.Gitlab.Users, aaru.WebFS)

	startServer(r, config.ServerHost)
}

func initDefaults(dbStore *store.DBStore) {
	roles, _ := dbStore.ListRoles()
	if len(roles) > 0 {
		// 补充创建 viewer 角色（如果不存在）
		if _, err := dbStore.GetRoleByName("viewer"); err != nil {
			viewerRole := &model.Role{Name: "viewer", Description: "观察者，仅查看"}
			dbStore.CreateRole(viewerRole)
			dbStore.SetRolePermissions(viewerRole.ID, []model.Permission{
				{DeployUnitCode: "*", Action: "view"},
			})
		}
		// 为 admin 用户补充 allowed_silos="*"
		dbStore.SetAdminWildcard()
		return
	}
	adminRole := &model.Role{Name: "admin", Description: "管理员，拥有所有权限"}
	dbStore.CreateRole(adminRole)
	devRole := &model.Role{Name: "developer", Description: "开发者，可以创建和部署"}
	dbStore.CreateRole(devRole)
	opsRole := &model.Role{Name: "operator", Description: "运维人员，可以审批"}
	dbStore.CreateRole(opsRole)
	viewerRole := &model.Role{Name: "viewer", Description: "观察者，仅查看"}
	dbStore.CreateRole(viewerRole)

	dbStore.SetRolePermissions(adminRole.ID, []model.Permission{
		{DeployUnitCode: "*", Action: "deploy"},
		{DeployUnitCode: "*", Action: "approve"},
		{DeployUnitCode: "*", Action: "view"},
		{DeployUnitCode: "*", Action: "manage"},
	})
	dbStore.SetRolePermissions(devRole.ID, []model.Permission{
		{DeployUnitCode: "*", Action: "deploy"},
		{DeployUnitCode: "*", Action: "view"},
	})
	dbStore.SetRolePermissions(opsRole.ID, []model.Permission{
		{DeployUnitCode: "*", Action: "approve"},
		{DeployUnitCode: "*", Action: "view"},
	})
	dbStore.SetRolePermissions(viewerRole.ID, []model.Permission{
		{DeployUnitCode: "*", Action: "view"},
	})
}

func startServer(router *gin.Engine, host string) {
	server := &http.Server{
		Addr:           host,
		Handler:        router,
		ReadTimeout:    30 * time.Second,
		WriteTimeout:   30 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}
	log.Printf("Aaru server starting on %s", host)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func setupCORS(router *gin.Engine) {
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, PATCH")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})
}
