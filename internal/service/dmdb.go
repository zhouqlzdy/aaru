package service

import (
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"

	"aaru/internal/model"
	"github.com/go-resty/resty/v2"
)

type DMDBClient struct {
	baseURL   string
	devopsURL string
	token     string
	client    *resty.Client
}

func NewDMDBClient(baseURL, devopsURL, token string) *DMDBClient {
	c := &DMDBClient{
		baseURL:   baseURL,
		devopsURL: devopsURL,
		token:     token,
		client:    resty.New(),
	}
	if token != "" {
		c.client.SetHeader("token", token)
	}
	return c
}

func (d *DMDBClient) ping() error {
	resp, err := d.client.R().Get(d.baseURL + "/ping")
	if err != nil {
		return err
	}
	if resp.StatusCode() != 200 {
		return fmt.Errorf("DMDB not reachable, status=%d", resp.StatusCode())
	}
	return nil
}

func (d *DMDBClient) get(path string, result interface{}) error {
	resp, err := d.client.R().SetResult(result).Get(d.baseURL + path)
	if err != nil {
		return fmt.Errorf("GET %s: %w", path, err)
	}
	if resp.StatusCode() != 200 {
		return fmt.Errorf("GET %s: status=%d", path, resp.StatusCode())
	}
	return nil
}

// ListEnvironments 获取环境列表
func (d *DMDBClient) ListEnvironments() ([]model.EnvInfo, error) {
	var resp model.DMDBListResponse
	if err := d.get("/api/list/env-raw", &resp); err != nil {
		return nil, err
	}
	var envs []model.EnvInfo
	if err := json.Unmarshal(resp.Envs, &envs); err != nil {
		return nil, fmt.Errorf("unmarshal envs: %w", err)
	}
	return envs, nil
}

// ListSilos 获取竖井列表
func (d *DMDBClient) ListSilos() ([]model.SiloInfo, error) {
	var resp model.DMDBListResponse
	if err := d.get("/api/list/silo", &resp); err != nil {
		return nil, err
	}
	var silos []model.SiloInfo
	if err := json.Unmarshal(resp.Silos, &silos); err != nil {
		return nil, fmt.Errorf("unmarshal silos: %w", err)
	}
	return silos, nil
}

// ListSystems 获取业务系统列表
func (d *DMDBClient) ListSystems() ([]model.SystemInfo, error) {
	var resp model.DMDBListResponse
	if err := d.get("/api/list/system", &resp); err != nil {
		return nil, err
	}
	var systems []model.SystemInfo
	if err := json.Unmarshal(resp.Systems, &systems); err != nil {
		return nil, fmt.Errorf("unmarshal systems: %w", err)
	}
	return systems, nil
}

// QueryDeployUnits 查询部署单元
func (d *DMDBClient) QueryDeployUnits(env, system, silo string) ([]model.DeployUnitInfo, error) {
	parts := []string{"/api/query-du", env}
	if system != "" {
		parts = append(parts, system)
	}
	if silo != "" {
		parts = append(parts, silo)
	}
	path := strings.Join(parts, "/")
	var dus []model.DeployUnitInfo
	if err := d.get(path, &dus); err != nil {
		return nil, err
	}
	return dus, nil
}

// GetDeployUnitByCode 获取单个部署单元
func (d *DMDBClient) GetDeployUnitByCode(env, code string) (*model.DeployUnitInfo, error) {
	var du model.DeployUnitInfo
	if err := d.get("/api/get-du/"+env+"/"+code, &du); err != nil {
		return nil, err
	}
	if du.BizSerial == "" {
		return nil, fmt.Errorf("deploy unit %s/%s not found", env, code)
	}
	return &du, nil
}

// getRawDU 获取单个DU的完整原始JSON数据
func (d *DMDBClient) getRawDU(env, code string) (map[string]interface{}, error) {
	var raw map[string]interface{}
	if err := d.get("/api/get-du/"+env+"/"+code, &raw); err != nil {
		return nil, err
	}
	if raw["biz_serial"] == nil || raw["biz_serial"] == "" {
		return nil, fmt.Errorf("deploy unit %s/%s not found", env, code)
	}
	return raw, nil
}

// GetEnvDetail 获取环境详情
func (d *DMDBClient) GetEnvDetail(code string) (*model.EnvInfo, error) {
	var env model.EnvInfo
	if err := d.get("/api/query-env/"+code, &env); err != nil {
		return nil, err
	}
	if env.Env == "" {
		// 尝试从完整结构中提取
		var raw json.RawMessage
		if err := d.get("/api/query-env/"+code, &raw); err != nil {
			return nil, err
		}
		var partial struct {
			Env  string `json:"Env"`
			Name string `json:"name"`
		}
		if err := json.Unmarshal(raw, &partial); err == nil {
			env.Env = partial.Env
			env.Name = partial.Name
		}
	}
	if env.Env == "" {
		return nil, fmt.Errorf("env %s not found", code)
	}
	return &env, nil
}

// ListAllDUs 从DevOps API获取所有部署单元列表，支持按竖井和系统筛选
func (d *DMDBClient) ListAllDUs(silo, system string) ([]model.DevOpsDUItem, error) {
	path := "/api/v1/devops/list-du/"
	params := make(map[string]string)
	if silo != "" {
		params["silo"] = silo
	}
	if system != "" {
		params["system"] = system
	}
	var resp model.DevOpsDUListResponse
	if err := d.getFromDevops(path, params, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// flattenFields 将map[string]interface{}扁平化为map[string]string，嵌套值序列化为JSON
func flattenFields(raw map[string]interface{}) map[string]string {
	fields := make(map[string]string)
	for k, v := range raw {
		switch val := v.(type) {
		case string:
			fields[k] = val
		case float64:
			fields[k] = fmt.Sprintf("%v", val)
		case bool:
			if val {
				fields[k] = "true"
			} else {
				fields[k] = "false"
			}
		case nil:
			fields[k] = ""
		default:
			// 嵌套结构（数组、对象等）→ JSON字符串
			b, err := json.Marshal(val)
			if err != nil {
				fields[k] = fmt.Sprintf("%v", val)
			} else {
				fields[k] = string(b)
			}
		}
	}
	return fields
}

// CompareDUConfig 获取某个DU在所有DMDB环境中的完整配置，用于跨环境对比展示。
// 会折叠仅tag不同的initDb字段，并展开对象数组为子行。
func (d *DMDBClient) CompareDUConfig(duCode string) ([]model.DUConfigSnapshot, error) {
	snapshots, err := d.CompareDUConfigRaw(duCode)
	if err != nil {
		return nil, err
	}
	// 后处理：InitDb/InitDbAuth/InitDbFinal 如果仅tag不同则简化展示
	collapseInitTagOnly(snapshots)
	// 展开剩余的对象数组JSON字段为独立子行
	expandObjectArrayFields(snapshots, 10)
	return snapshots, nil
}

// CompareDUConfigRaw 获取原始快照，不做折叠/展开（供 BatchCreateRelease 等需要原始数据的场景使用）
func (d *DMDBClient) CompareDUConfigRaw(duCode string) ([]model.DUConfigSnapshot, error) {
	envs, err := d.ListEnvironments()
	if err != nil {
		return nil, fmt.Errorf("list environments: %w", err)
	}

	var snapshots []model.DUConfigSnapshot
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, env := range envs {
		wg.Add(1)
		go func(envCode, envName string) {
			defer wg.Done()
			raw, err := d.getRawDU(envCode, duCode)
			if err != nil {
				log.Printf("CompareDUConfigRaw: getRawDU(%s, %s): %v", envCode, duCode, err)
				return
			}
			fields := flattenFields(raw)
			mu.Lock()
			snapshots = append(snapshots, model.DUConfigSnapshot{
				Env:     envCode,
				EnvName: envName,
				Fields:  fields,
			})
			mu.Unlock()
		}(env.Env, env.Name)
	}
	wg.Wait()

	return snapshots, nil
}

// collapseInitTagOnly 检查 InitDb / InitDbAuth / InitDbFinal 三个配置项，
// 如果各环境间仅有代码仓库URL中的tag版本不同（且tag与ArtifactVersion一致），
// 则替换为简要提示而非完整JSON。
func collapseInitTagOnly(snapshots []model.DUConfigSnapshot) {
	initKeys := []string{"initDb", "initDbAuth", "initDbFinal"}
	for _, key := range initKeys {
		if !tryCollapseInitKey(snapshots, key) {
			continue
		}
	}
}

func tryCollapseInitKey(snapshots []model.DUConfigSnapshot, key string) bool {
	type initItem map[string]interface{}
	var parsed [][]initItem
	tags := make([]string, len(snapshots))

	for i, s := range snapshots {
		raw, ok := s.Fields[key]
		if !ok || raw == "" || raw == "[]" || raw == "null" {
			return false
		}
		var items []initItem
		if err := json.Unmarshal([]byte(raw), &items); err != nil {
			return false
		}
		if len(items) == 0 {
			return false
		}
		// 收集ArtifactVersion用于后续校验
		if av, ok := s.Fields["ArtifactVersion"]; ok {
			tags[i] = av
		}
		parsed = append(parsed, items)
	}

	if len(parsed) < 2 {
		return false
	}

	// 检查所有环境数组长度一致
	n := len(parsed[0])
	for _, p := range parsed {
		if len(p) != n {
			return false
		}
	}

	// 逐元素比对：每个位置的元素结构一致，仅source URL中的tag不同
	tagSet := make(map[string]bool)
	for idx := 0; idx < n; idx++ {
		var baseItem initItem
		var baseSource string
		for i, p := range parsed {
			item := p[idx]
			// 深拷贝第一项作为基准
			if i == 0 {
				baseItem = make(initItem)
				for k, v := range item {
					baseItem[k] = v
				}
				if s, ok := item["source"].(string); ok {
					baseSource = s
				}
				continue
			}
			// 比较结构：除source外所有字段必须完全一致
			source, hasSource := item["source"].(string)
			if !hasSource {
				return false
			}
			for k, v := range item {
				if k == "source" {
					continue
				}
				bv, ok := baseItem[k]
				if !ok {
					return false
				}
				if fmt.Sprintf("%v", v) != fmt.Sprintf("%v", bv) {
					return false
				}
			}
			// 检查source仅tag不同
			tag, same := extractTagAndCompare(baseSource, source)
			if !same {
				return false
			}
			if tag != "" {
				tagSet[tag] = true
			}
			// 校验tag与ArtifactVersion一致
			av := tags[i]
			if av == "" {
				av = tags[0]
			}
			if tag != "" && av != "" && tag != av {
				return false
			}
		}
	}

	// 所有检查通过，替换为简要提示
	tagList := make([]string, 0, len(tagSet))
	for t := range tagSet {
		tagList = append(tagList, t)
	}
	sort.Strings(tagList)
	summary := fmt.Sprintf("仅tag版本不同 (%d个环境共%d个不同tag)", len(snapshots), len(tagList))
	for _, s := range snapshots {
		if av, ok := s.Fields["ArtifactVersion"]; ok {
			s.Fields[key+"_Note"] = summary + " | 当前环境: " + s.EnvName + " tag=" + av
		}
	}
	// 保留原始Init字段（不删除），前端自动同步 initDb tag 需要原始数据
	return true
}

// extractTagAndCompare 比较两个代码仓库URL，提取tag并判断是否仅tag不同。
// 返回 (tag, 是否仅tag不同)
func extractTagAndCompare(url1, url2 string) (string, bool) {
	idx1 := strings.Index(url1, "/blob/")
	idx2 := strings.Index(url2, "/blob/")
	if idx1 < 0 || idx2 < 0 {
		return "", false
	}
	prefix1 := url1[:idx1]
	prefix2 := url2[:idx2]
	if prefix1 != prefix2 {
		return "", false
	}
	rest1 := url1[idx1+len("/blob/"):]
	rest2 := url2[idx2+len("/blob/"):]
	slash1 := strings.Index(rest1, "/")
	slash2 := strings.Index(rest2, "/")
	if slash1 < 0 || slash2 < 0 {
		return "", false
	}
	_ = rest1[:slash1] // tag1
	tag2 := rest2[:slash2]
	after1 := rest1[slash1:]
	after2 := rest2[slash2:]
	if after1 != after2 {
		return "", false
	}
	return tag2, true
}

// expandObjectArrayFields 将对象数组JSON字段展开为独立子行。
// 短数组（≤maxItems）展开为 FieldName[index].subKey 格式，
// 超过阈值的数组保持原JSON不变。
// 必须在 collapseInitTagOnly 之后调用——其中被折叠的字段不会重复展开。
func expandObjectArrayFields(snapshots []model.DUConfigSnapshot, maxItems int) {
	if len(snapshots) == 0 {
		return
	}

	// 收集所有snapshot中值为JSON对象数组的字段名
	candidateKeys := make(map[string]bool)
	for _, s := range snapshots {
		for k, v := range s.Fields {
			if candidateKeys[k] {
				continue
			}
			if isObjectArrayJSON(v) {
				candidateKeys[k] = true
			}
		}
	}

	for key := range candidateKeys {
		// 找出各个snapshot中该字段的最大数组长度
		maxLen := 0
		for _, s := range snapshots {
			raw, ok := s.Fields[key]
			if !ok || raw == "" || raw == "null" {
				continue
			}
			var arr []map[string]interface{}
			if err := json.Unmarshal([]byte(raw), &arr); err != nil {
				continue
			}
			if len(arr) > maxLen {
				maxLen = len(arr)
			}
		}

		// 超过阈值或空数组，保持原始JSON不变
		if maxLen > maxItems || maxLen == 0 {
			continue
		}

		// 收集所有snapshot中该对象数组的所有子键名，确保各环境展开后列一致
		allSubKeys := make(map[string]bool)
		for _, s := range snapshots {
			raw, ok := s.Fields[key]
			if !ok || raw == "" || raw == "null" {
				continue
			}
			var arr []map[string]interface{}
			if err := json.Unmarshal([]byte(raw), &arr); err != nil {
				continue
			}
			for _, item := range arr {
				for k := range item {
					allSubKeys[k] = true
				}
			}
		}
		sortedSubKeys := make([]string, 0, len(allSubKeys))
		for k := range allSubKeys {
			sortedSubKeys = append(sortedSubKeys, k)
		}
		sort.Strings(sortedSubKeys)

		// 逐snapshot展开
		for si, s := range snapshots {
			raw, ok := s.Fields[key]
			if !ok || raw == "" || raw == "null" {
				// 该环境没有此字段——为所有子键设空值
				for i := 0; i < maxLen; i++ {
					for _, sk := range sortedSubKeys {
						subKey := fmt.Sprintf("%s[%d].%s", key, i, sk)
						snapshots[si].Fields[subKey] = ""
					}
				}
				continue
			}
			var arr []map[string]interface{}
			if err := json.Unmarshal([]byte(raw), &arr); err != nil {
				continue
			}
			// 展开每个数组元素
			for i, item := range arr {
				for _, sk := range sortedSubKeys {
					subKey := fmt.Sprintf("%s[%d].%s", key, i, sk)
					if v, ok := item[sk]; ok {
						snapshots[si].Fields[subKey] = fmt.Sprintf("%v", v)
					} else {
						snapshots[si].Fields[subKey] = ""
					}
				}
			}
			// 如果该环境项数少于maxLen，剩余位置填充空
			for i := len(arr); i < maxLen; i++ {
				for _, sk := range sortedSubKeys {
					subKey := fmt.Sprintf("%s[%d].%s", key, i, sk)
					snapshots[si].Fields[subKey] = ""
				}
			}
		}

		// 保留原始JSON字段，不删除
	}
}

// isObjectArrayJSON 快速判断字符串是否为JSON对象数组
// 匹配 [{"a":1}] 这种格式，排除 ["a","b"] 字符串数组和 {"a":1} 对象
func isObjectArrayJSON(s string) bool {
	if len(s) < 3 || s[0] != '[' {
		return false
	}
	// 跳过空白字符，检查第一个元素是否为 {
	i := 1
	for i < len(s) && s[i] == ' ' {
		i++
	}
	return i < len(s) && s[i] == '{'
}

func (d *DMDBClient) getFromDevops(path string, params map[string]string, result interface{}) error {
	req := d.client.R().SetResult(result)
	for k, v := range params {
		req.SetQueryParam(k, v)
	}
	resp, err := req.Get(d.devopsURL + path)
	if err != nil {
		return fmt.Errorf("GET %s: %w", path, err)
	}
	if resp.StatusCode() != 200 {
		return fmt.Errorf("GET %s: status=%d", path, resp.StatusCode())
	}
	return nil
}

// UpdateDeployUnit 调用DMDB批量更新接口更新部署单元（Aaru每次只更新1个）
func (d *DMDBClient) UpdateDeployUnit(env string, updates []map[string]interface{}) ([]model.BatchUpdateResult, error) {
	var resp model.BatchUpdateResponse
	r, err := d.client.R().SetBody(updates).SetResult(&resp).
		Post(d.baseURL + "/api/du-batch-update/" + env)
	if err != nil {
		return nil, fmt.Errorf("POST /api/du-batch-update/%s: %w", env, err)
	}
	if r.StatusCode() != 200 {
		return nil, fmt.Errorf("POST /api/du-batch-update/%s: status=%d body=%s", env, r.StatusCode(), r.String())
	}
	return resp.Results, nil
}

// GetDeployUnitMeta 获取DU的id和classCode（用于构建更新请求）
func (d *DMDBClient) GetDeployUnitMeta(env, code string) (id, classCode string, err error) {
	du, err := d.GetDeployUnitByCode(env, code)
	if err != nil {
		return "", "", err
	}
	return du.Id, du.ClassCode, nil
}

// GetAllDeployUnits 查询所有环境的部署单元
func (d *DMDBClient) GetAllDeployUnits() ([]model.DeployUnitInfo, error) {
	envs, err := d.ListEnvironments()
	if err != nil {
		return nil, err
	}
	var mu sync.Mutex
	var all []model.DeployUnitInfo
	var wg sync.WaitGroup
	for _, env := range envs {
		wg.Add(1)
		go func(code string) {
			defer wg.Done()
			dus, err := d.QueryDeployUnits(code, "", "")
			if err != nil {
				log.Printf("query dus for env %s: %v", code, err)
				return
			}
			mu.Lock()
			all = append(all, dus...)
			mu.Unlock()
		}(env.Env)
	}
	wg.Wait()
	return all, nil
}
