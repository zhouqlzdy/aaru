package service

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"

	"aaru/internal/model"
	"aaru/internal/store"
)

type BlueprintService struct{ store *store.DBStore }

func NewBlueprintService(s *store.DBStore) *BlueprintService { return &BlueprintService{store: s} }

func genToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		log.Printf("genToken: rand.Read failed: %v", err)
	}
	return hex.EncodeToString(b)
}

type BlueprintInput struct {
	Name        string                `json:"name"`
	Description string                `json:"description"`
	Nodes       []model.BlueprintNode `json:"nodes"`
	Edges       []model.BlueprintEdge `json:"edges"`
}

func (b *BlueprintService) Create(in *BlueprintInput) (*model.PromotionBlueprint, error) {
	if err := b.prepareAndValidate(in); err != nil {
		return nil, err
	}
	bp := &model.PromotionBlueprint{Name: in.Name, Description: in.Description}
	if err := b.store.CreateBlueprint(bp); err != nil {
		return nil, err
	}

	// 逐个创建节点，GORM 会回填自增 ID
	oldToNew := make(map[uint]uint, len(in.Nodes))
	for i := range in.Nodes {
		oldID := in.Nodes[i].ID
		in.Nodes[i].ID = 0
		in.Nodes[i].BlueprintID = bp.ID
		if err := b.store.CreateNode(&in.Nodes[i]); err != nil {
			return nil, fmt.Errorf("create node: %w", err)
		}
		oldToNew[oldID] = in.Nodes[i].ID
	}

	// 映射边的节点引用
	for i := range in.Edges {
		in.Edges[i].BlueprintID = bp.ID
		in.Edges[i].FromNodeID = oldToNew[in.Edges[i].FromNodeID]
		in.Edges[i].ToNodeID = oldToNew[in.Edges[i].ToNodeID]
	}

	if err := b.store.CreateEdges(in.Edges); err != nil {
		return nil, fmt.Errorf("create edges: %w", err)
	}
	bp2, err := b.store.GetBlueprint(bp.ID)
	if err != nil {
		return nil, fmt.Errorf("reload blueprint: %w", err)
	}
	return bp2, nil
}

func (b *BlueprintService) Update(id uint, in *BlueprintInput) (*model.PromotionBlueprint, error) {
	if err := b.prepareAndValidate(in); err != nil {
		return nil, err
	}
	bp, err := b.store.GetBlueprint(id)
	if err != nil {
		return nil, err
	}
	bp.Name = in.Name
	bp.Description = in.Description
	if err := b.store.UpdateBlueprint(bp); err != nil {
		return nil, fmt.Errorf("update blueprint: %w", err)
	}
	if err := b.store.DeleteEdgesByBlueprint(id); err != nil {
		return nil, fmt.Errorf("delete edges: %w", err)
	}
	if err := b.store.DeleteNodesByBlueprint(id); err != nil {
		return nil, fmt.Errorf("delete nodes: %w", err)
	}

	// 逐个创建节点，GORM 回填自增 ID
	oldToNew := make(map[uint]uint, len(in.Nodes))
	for i := range in.Nodes {
		oldID := in.Nodes[i].ID
		in.Nodes[i].ID = 0
		in.Nodes[i].BlueprintID = id
		if err := b.store.CreateNode(&in.Nodes[i]); err != nil {
			return nil, fmt.Errorf("create node: %w", err)
		}
		oldToNew[oldID] = in.Nodes[i].ID
	}

	for i := range in.Edges {
		in.Edges[i].BlueprintID = id
		in.Edges[i].FromNodeID = oldToNew[in.Edges[i].FromNodeID]
		in.Edges[i].ToNodeID = oldToNew[in.Edges[i].ToNodeID]
	}
	if err := b.store.CreateEdges(in.Edges); err != nil {
		return nil, fmt.Errorf("create edges: %w", err)
	}

	bp2, err := b.store.GetBlueprint(id)
	if err != nil {
		return nil, fmt.Errorf("reload blueprint: %w", err)
	}
	return bp2, nil
}

// ensureApprovalRole 为指定环境创建/查找审批角色
func (b *BlueprintService) ensureApprovalRole(envCode, envName string) (*model.Role, error) {
	roleName := "approver-" + envCode
	roles, err := b.store.ListRoles()
	if err != nil {
		return nil, fmt.Errorf("list roles: %w", err)
	}
	for _, r := range roles {
		if r.Name == roleName {
			return &r, nil
		}
	}
	role := &model.Role{Name: roleName, Description: envName + " 环境审批角色（自动创建）"}
	if err := b.store.CreateRole(role); err != nil {
		return nil, err
	}
	// 自动授予 approve 权限
	if err := b.store.SetRolePermissions(role.ID, []model.Permission{
		{DeployUnitCode: "*", Action: "approve"},
		{DeployUnitCode: "*", Action: "view"},
	}); err != nil {
		return nil, fmt.Errorf("set role permissions: %w", err)
	}
	return role, nil
}

func (b *BlueprintService) prepareAndValidate(in *BlueprintInput) error {
	for i := range in.Nodes {
		if in.Nodes[i].GateType == "api_hook" && in.Nodes[i].WebhookToken == "" {
			in.Nodes[i].WebhookToken = genToken()
		}
		// approver 角色已废弃，改用 User.allowed_silos + allowed_envs 控制权限
		in.Nodes[i].ApproveRoleID = nil
	}
	seenEnv := make(map[string]bool)
	for _, n := range in.Nodes {
		if n.EnvCode == "" {
			return fmt.Errorf("节点 %s 未选择环境", n.EnvName)
		}
		if seenEnv[n.EnvCode] {
			return fmt.Errorf("环境 %s 在蓝图中重复出现", n.EnvCode)
		}
		seenEnv[n.EnvCode] = true
	}
	seenEdge := make(map[string]bool)
	for _, e := range in.Edges {
		key := fmt.Sprintf("%d->%d", e.FromNodeID, e.ToNodeID)
		if seenEdge[key] {
			return fmt.Errorf("边 %d→%d 重复", e.FromNodeID, e.ToNodeID)
		}
		if e.FromNodeID == e.ToNodeID {
			return fmt.Errorf("不允许自环边（%d→%d）", e.FromNodeID, e.ToNodeID)
		}
		seenEdge[key] = true
	}
	if err := validateDAG(in.Nodes, in.Edges); err != nil {
		return err
	}
	return nil
}

func (b *BlueprintService) Get(id uint) (*model.PromotionBlueprint, error) {
	return b.store.GetBlueprint(id)
}

func (b *BlueprintService) List() ([]map[string]interface{}, error) {
	bps, err := b.store.ListBlueprints()
	if err != nil {
		return nil, fmt.Errorf("list blueprints: %w", err)
	}
	var r []map[string]interface{}
	for _, bp := range bps {
		nodes, _ := b.store.GetBlueprintNodes(bp.ID)
		edges, _ := b.store.GetBlueprintEdges(bp.ID)
		r = append(r, map[string]interface{}{
			"id": bp.ID, "name": bp.Name, "description": bp.Description,
			"node_count": len(nodes), "edge_count": len(edges),
			"created_at": bp.CreatedAt, "updated_at": bp.UpdatedAt,
		})
	}
	return r, nil
}
func (b *BlueprintService) Delete(id uint) error { return b.store.DeleteBlueprint(id) }

func (b *BlueprintService) GetSourceNodeIDs(bpID uint) ([]uint, error) {
	nodes, _ := b.store.GetBlueprintNodes(bpID)
	edges, _ := b.store.GetBlueprintEdges(bpID)
	hasIn := make(map[uint]bool)
	for _, e := range edges {
		hasIn[e.ToNodeID] = true
	}
	var src []uint
	for _, n := range nodes {
		if !hasIn[n.ID] {
			src = append(src, n.ID)
		}
	}
	return src, nil
}
func (b *BlueprintService) GetParentNodeIDs(bpID, nodeID uint) ([]uint, error) {
	edges, _ := b.store.GetBlueprintEdges(bpID)
	var p []uint
	for _, e := range edges {
		if e.ToNodeID == nodeID {
			p = append(p, e.FromNodeID)
		}
	}
	return p, nil
}
func (b *BlueprintService) GetChildNodeIDs(bpID, nodeID uint) ([]uint, error) {
	edges, _ := b.store.GetBlueprintEdges(bpID)
	var c []uint
	for _, e := range edges {
		if e.FromNodeID == nodeID {
			c = append(c, e.ToNodeID)
		}
	}
	return c, nil
}
func (b *BlueprintService) IsSinkNode(bpID, nodeID uint) (bool, error) {
	edges, _ := b.store.GetBlueprintEdges(bpID)
	for _, e := range edges {
		if e.FromNodeID == nodeID {
			return false, nil
		}
	}
	return true, nil
}

// validateDAG 验证节点和边构成有向无环图。
// 注意：节点 ID 可能尚未分配（为 0），此时用数组索引作为临时 ID 进行验证。
func validateDAG(nodes []model.BlueprintNode, edges []model.BlueprintEdge) error {
	// 构建临时 ID 映射：用数组索引 + 1 作为临时 ID
	// 客户端发送的 ID 可能为 0（新节点）或任意值，不能直接用于验证
	idSet := make(map[uint]bool)
	for i := range nodes {
		tmpID := nodes[i].ID
		if tmpID == 0 {
			tmpID = uint(i + 1) // 临时 ID
		}
		idSet[tmpID] = true
	}

	// 验证边引用的节点存在（用同样的临时 ID 逻辑）
	// 但由于 edges 引用的是客户端提供的原始 ID，需要建立 oldID -> 临时ID 的映射
	oldToTmp := make(map[uint]uint)
	for i := range nodes {
		oldID := nodes[i].ID
		if oldID == 0 {
			oldToTmp[uint(i)] = uint(i + 1) // 客户端用 0-based index
		} else {
			oldToTmp[oldID] = oldID
		}
	}

	// 重建边的临时 ID
	type tmpEdge struct{ from, to uint }
	var tmpEdges []tmpEdge
	for _, e := range edges {
		from, okF := oldToTmp[e.FromNodeID]
		to, okT := oldToTmp[e.ToNodeID]
		if !okF {
			return fmt.Errorf("边从节点%d出发，但该节点不存在", e.FromNodeID)
		}
		if !okT {
			return fmt.Errorf("边指向节点%d，但该节点不存在", e.ToNodeID)
		}
		tmpEdges = append(tmpEdges, tmpEdge{from, to})
	}

	// Kahn 算法检测环
	inDegree := make(map[uint]int)
	adj := make(map[uint][]uint)
	for id := range idSet {
		inDegree[id] = 0
	}
	for _, e := range tmpEdges {
		adj[e.from] = append(adj[e.from], e.to)
		inDegree[e.to]++
	}
	var q []uint
	for id := range idSet {
		if inDegree[id] == 0 {
			q = append(q, id)
		}
	}
	visited := 0
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		visited++
		for _, v := range adj[u] {
			inDegree[v]--
			if inDegree[v] == 0 {
				q = append(q, v)
			}
		}
	}
	if visited != len(idSet) {
		return fmt.Errorf("蓝图中存在循环依赖（仅%d/%d个节点可达）", visited, len(idSet))
	}
	return nil
}
