package model

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Config struct {
	ServerHost string       `yaml:"server_host,omitempty"`
	DSN        string       `yaml:"dsn,omitempty"`
	JwtSecret  string       `yaml:"jwt_secret,omitempty"`
	DMDB       DMDBConfig   `yaml:"dmdb"`
	DevOps     DevOpsConfig `yaml:"devops"`
	Gitlab     GitlabMock   `yaml:"gitlab"`
}

type DMDBConfig struct {
	ServerAddress string `yaml:"server_address"`
	Token         string `yaml:"token"`
}

type DevOpsConfig struct {
	ServerAddress string `yaml:"server_address"`
}

type GitlabMock struct {
	Enabled     bool     `yaml:"enabled"`
	Users       []string `yaml:"users"`
	URL         string   `yaml:"url"`
	AppID       string   `yaml:"app_id"`
	AppSecret   string   `yaml:"app_secret"`
	CallbackURL string   `yaml:"callback_url"`
}

var configPaths = []string{
	filepath.Join(".", "aaru.yaml"),
	filepath.Join(os.Getenv("HOME"), ".aaru", "config.yaml"),
}

// LoadConfig 加载配置：先从 YAML 文件读取，再用环境变量覆盖。
func LoadConfig() *Config {
	cfg := defaultConfig()

	// 尝试从 YAML 文件加载
	for _, p := range configPaths {
		if _, err := os.Stat(p); err == nil {
			if data, err := os.ReadFile(p); err == nil {
				yaml.Unmarshal(data, cfg)
			}
			break
		}
	}

	// 环境变量覆盖
	applyEnvOverrides(cfg)
	return cfg
}

func defaultConfig() *Config {
	return &Config{
		ServerHost: "127.0.0.1:8080",
		DSN:        "root:aaru123@tcp(127.0.0.1:3306)/aaru?charset=utf8mb4&parseTime=True&loc=Local",
		JwtSecret:  "aaru-dev-secret-change-in-production",
		DMDB: DMDBConfig{
			ServerAddress: "http://127.0.0.1:3632",
		},
		DevOps: DevOpsConfig{
			ServerAddress: "http://127.0.0.1:8733",
		},
		Gitlab: GitlabMock{
			URL: "http://localhost",
		},
	}
}

func applyEnvOverrides(cfg *Config) {
	setIfPresent(&cfg.ServerHost, "AARU_SERVER_HOST")
	setIfPresent(&cfg.DSN, "AARU_DSN")
	setIfPresent(&cfg.JwtSecret, "AARU_JWT_SECRET")
	setIfPresent(&cfg.DMDB.ServerAddress, "AARU_DMDB_URL")
	setIfPresent(&cfg.DMDB.Token, "AARU_DMDB_TOKEN")
	setIfPresent(&cfg.DevOps.ServerAddress, "AARU_DEVOPS_URL")
	setIfPresent(&cfg.Gitlab.URL, "AARU_GITLAB_URL")
	setIfPresent(&cfg.Gitlab.AppID, "AARU_GITLAB_APP_ID")
	setIfPresent(&cfg.Gitlab.AppSecret, "AARU_GITLAB_APP_SECRET")
	setIfPresent(&cfg.Gitlab.CallbackURL, "AARU_GITLAB_CALLBACK_URL")
	if cfg.Gitlab.AppID != "" {
		cfg.Gitlab.Enabled = true
	}
}

func setIfPresent(field *string, envKey string) {
	if v := os.Getenv(envKey); v != "" {
		*field = v
	}
}
