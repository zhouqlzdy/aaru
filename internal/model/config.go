package model

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Config struct {
	ServerHost  string       `yaml:"server_host,omitempty"`
	DBDriver    string       `yaml:"db_driver,omitempty"` // sqlite 或 mysql
	DSN         string       `yaml:"dsn,omitempty"`       // MySQL DSN，如 user:pass@tcp(host:port)/dbname?charset=utf8mb4&parseTime=True&loc=Local
	DbPath      string       `yaml:"db_path,omitempty"`   // SQLite 文件路径（db_driver=sqlite 时使用）
	JwtSecret   string       `yaml:"jwt_secret,omitempty"`
	DMDB        DMDBConfig   `yaml:"dmdb"`
	DevOps      DevOpsConfig `yaml:"devops"`
	Gitlab      GitlabMock   `yaml:"gitlab"`
	PromotePlan []EnvConfig  `yaml:"promote_plan"`
}

type DMDBConfig struct {
	ServerAddress string `yaml:"server_address"`
	Token         string `yaml:"token"`
}

type DevOpsConfig struct {
	ServerAddress string `yaml:"server_address"`
}

type GitlabMock struct {
	Enabled bool     `yaml:"enabled"`
	Users   []string `yaml:"users"`
}

type EnvConfig struct {
	Code string `yaml:"code"`
	Name string `yaml:"name"`
}

func LoadConfigFromEnv() *Config {
	home, _ := os.UserHomeDir()
	path := filepath.Join(home, ".aaru", "config.yaml")
	cfg, err := LoadConfig(path)
	if err != nil {
		// return default
		return getDefaultConfig()
	}
	return cfg
}

func LoadConfig(path string) (*Config, error) {
	config := getDefaultConfig()
	data, err := os.ReadFile(path)
	if err != nil {
		return config, nil
	}
	err = yaml.Unmarshal(data, config)
	return config, err
}

func getDefaultConfig() *Config {
	return &Config{
		ServerHost: "127.0.0.1:8080",
		DBDriver:   "sqlite",
		DSN:        "",
		DbPath:     filepath.Join(os.TempDir(), "aaru.db"),
		JwtSecret:  "aaru-dev-secret-change-in-production",
		DMDB: DMDBConfig{
			ServerAddress: "http://127.0.0.1:3632",
		},
		DevOps: DevOpsConfig{
			ServerAddress: "http://127.0.0.1:8733",
		},
		Gitlab: GitlabMock{
			Enabled: true,
			Users:   []string{"alice", "bob", "charlie"},
		},
		PromotePlan: []EnvConfig{
			{Code: "dev", Name: "开发环境"},
			{Code: "test", Name: "测试环境"},
			{Code: "uat", Name: "UAT环境"},
			{Code: "prod", Name: "生产环境"},
		},
	}
}
