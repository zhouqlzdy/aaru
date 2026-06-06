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
	if err := b.createNodesAndEdges(bp.ID, in); err != nil {
		return nil, err
	}
	bp2, err := b.store.GetBlueprint(bp.ID)
	if err != nil {
		return nil, fmt.Errorf("reload blueprint: %w", err)
	}
	return bp2, nil
}

func (b *BlueprintService) Update(id uint, in *BlueprintInput) (*model.PromotionBlueprint, int, error) {
	if err := b.prepareAndValidate(in); err != nil {
		return nil, 0, err
	}
	bp, err := b.store.GetBlueprint(id)
	if err != nil {
		return nil, 0, err
	}
	bp.Name = in.Name
	bp.Description = in.Description
	if err := b.store.UpdateBlueprint(bp); err != nil {
		return nil, 0, fmt.Errorf("update blueprint: %w", err)
	}

	// 加载现有节点和边，用于增量比较
	oldNodes, _ := b.store.GetBlueprintNodes(id)
	oldEdges, _ := b.store.GetBlueprintEdges(id)

	// 判断结构是否变化（节点增删 或 边增删）
	structureChanged := b.structureChanged(oldNodes, oldEdges, in.Nodes, in.Edges)

	// 增量更新节点：保留已有 ID，新建/删除变化的节点
	idMap, err := b.updateNodesIncremental(id, oldNodes, in.Nodes)
	if err != nil {
		return nil, 0, fmt.Errorf("update nodes: %w", err)
	}

	// 增量更新边（用 idMap 将客户端临时 ID 映射为实际 DB ID）
	if err := b.updateEdgesIncremental(id, oldEdges, in.Edges, idMap); err != nil {
		return nil, 0, fmt.Errorf("update edges: %w", err)
	}

	// 仅在结构变化时废弃在途发布
	var deprecatedCount int
	if structureChanged {
		activeReleases, _ := b.store.GetActiveReleasesByBlueprint(id)
		deprecatedCount = len(activeReleases)
		if deprecatedCount > 0 {
			if err := b.store.DeprecateReleasesByBlueprint(id); err != nil {
				log.Printf("deprecate releases for blueprint %d: %v", id, err)
			}
		}
	}

	bp2, err := b.store.GetBlueprint(id)
	if err != nil {
		return nil, 0, fmt.Errorf("reload blueprint: %w", err)
	}
	return bp2, deprecatedCount, nil
}

// structureChanged 判断蓝图的节点/边结构是否发生变化（忽略位置和属性变更）
func (b *BlueprintService) structureChanged(oldNodes []model.BlueprintNode, oldEdges []model.BlueprintEdge, newNodes []model.BlueprintNode, newEdges []model.BlueprintEdge) bool {
	if len(oldNodes) != len(newNodes) || len(oldEdges) != len(newEdges) {
		return true
	}
	// 比较节点的 env_code 集合
	oldEnvSet := make(map[string]bool, len(oldNodes))
	for _, n := range oldNodes {
		oldEnvSet[n.EnvCode] = true
	}
	for _, n := range newNodes {
		if !oldEnvSet[n.EnvCode] {
			return true
		}
	}
	// 通过 env_code 对比较边：旧边用 DB ID→env_code，新边用客户端 ID→env_code
	oldIDToEnv := make(map[uint]string, len(oldNodes))
	for _, n := range oldNodes {
		oldIDToEnv[n.ID] = n.EnvCode
	}
	newIDToEnv := make(map[uint]string, len(newNodes))
	for _, n := range newNodes {
		newIDToEnv[n.ID] = n.EnvCode
	}
	oldEdgeSet := make(map[string]bool, len(oldEdges))
	for _, e := range oldEdges {
		from := oldIDToEnv[e.FromNodeID]
		to := oldIDToEnv[e.ToNodeID]
		oldEdgeSet[from+"->"+to] = true
	}
	for _, e := range newEdges {
		from := newIDToEnv[e.FromNodeID]
		to := newIDToEnv[e.ToNodeID]
		if !oldEdgeSet[from+"->"+to] {
			return true
		}
	}
	return false
}

// updateNodesIncremental 增量更新节点：保留已有节点（更新属性），新建节点，删除多余节点。
// 返回 clientID→dbID 映射（包含已有节点和新建节点）。
func (b *BlueprintService) updateNodesIncremental(bpID uint, oldNodes []model.BlueprintNode, newNodes []model.BlueprintNode) (map[uint]uint, error) {
	oldByID := make(map[uint]*model.BlueprintNode, len(oldNodes))
	for i := range oldNodes {
		oldByID[oldNodes[i].ID] = &oldNodes[i]
	}
	seenOldIDs := make(map[uint]bool)
	idMap := make(map[uint]uint, len(newNodes)) // clientID → dbID

	for i := range newNodes {
		n := &newNodes[i]
		clientID := n.ID
		n.BlueprintID = bpID
		if existing, ok := oldByID[n.ID]; ok {
			// 已有节点：更新属性和位置，保留 ID
			existing.EnvCode = n.EnvCode
			existing.EnvName = n.EnvName
			existing.PositionX = n.PositionX
			existing.PositionY = n.PositionY
			existing.GateType = n.GateType
			existing.WebhookToken = n.WebhookToken
			if err := b.store.SaveNode(existing); err != nil {
				return nil, err
			}
			seenOldIDs[n.ID] = true
			idMap[clientID] = existing.ID
		} else {
			// 新节点：创建，获取分配的 ID
			n.ID = 0
			if err := b.store.CreateNode(n); err != nil {
				return nil, err
			}
			idMap[clientID] = n.ID
		}
	}

	// 删除不再存在的节点
	for _, old := range oldNodes {
		if !seenOldIDs[old.ID] {
			if err := b.store.DeleteNode(old.ID); err != nil {
				return nil, err
			}
		}
	}
	return idMap, nil
}

// updateEdgesIncremental 增量更新边：比较新旧边，保留/新建/删除。
// idMap 将客户端 node ID 映射为实际 DB node ID。
func (b *BlueprintService) updateEdgesIncremental(bpID uint, oldEdges []model.BlueprintEdge, newEdges []model.BlueprintEdge, idMap map[uint]uint) error {
	// 旧边：用 nodeID 对作为 key
	oldByKey := make(map[string]*model.BlueprintEdge, len(oldEdges))
	for i := range oldEdges {
		key := fmt.Sprintf("%d->%d", oldEdges[i].FromNodeID, oldEdges[i].ToNodeID)
		oldByKey[key] = &oldEdges[i]
	}

	// 新边：将客户端 ID 映射为实际 DB ID，再构建 key
	type resolvedEdge struct {
		from, to uint
		orig     model.BlueprintEdge
	}
	var resolved []resolvedEdge
	for _, e := range newEdges {
		fromDB, okF := idMap[e.FromNodeID]
		toDB, okT := idMap[e.ToNodeID]
		if !okF || !okT {
			return fmt.Errorf("边引用了未知节点 (from=%d, to=%d)", e.FromNodeID, e.ToNodeID)
		}
		resolved = append(resolved, resolvedEdge{from: fromDB, to: toDB, orig: e})
	}

	newByKey := make(map[string]bool, len(resolved))
	for _, re := range resolved {
		key := fmt.Sprintf("%d->%d", re.from, re.to)
		newByKey[key] = true
	}

	// 删除不再存在的边
	for key, edge := range oldByKey {
		if !newByKey[key] {
			if err := b.store.DeleteEdge(edge.ID); err != nil {
				return err
			}
		}
	}

	// 创建新边（用映射后的实际 DB ID）
	for _, re := range resolved {
		key := fmt.Sprintf("%d->%d", re.from, re.to)
		if oldByKey[key] == nil {
			e := re.orig
			e.ID = 0
			e.BlueprintID = bpID
			e.FromNodeID = re.from
			e.ToNodeID = re.to
			if err := b.store.CreateEdges([]model.BlueprintEdge{e}); err != nil {
				return err
			}
		}
	}
	return nil
}

// GetActiveReleases 查询使用指定蓝图的在途发布
func (b *BlueprintService) GetActiveReleases(bpID uint) ([]model.Release, error) {
	return b.store.GetActiveReleasesByBlueprint(bpID)
}

// createNodesAndEdges 逐个创建节点并建立 oldID→newID 映射，再批量创建边。
func (b *BlueprintService) createNodesAndEdges(bpID uint, in *BlueprintInput) error {
	oldToNew := make(map[uint]uint, len(in.Nodes))
	for i := range in.Nodes {
		oldID := in.Nodes[i].ID
		in.Nodes[i].ID = 0
		in.Nodes[i].BlueprintID = bpID
		if err := b.store.CreateNode(&in.Nodes[i]); err != nil {
			return fmt.Errorf("create node: %w", err)
		}
		oldToNew[oldID] = in.Nodes[i].ID
	}
	for i := range in.Edges {
		in.Edges[i].BlueprintID = bpID
		in.Edges[i].FromNodeID = oldToNew[in.Edges[i].FromNodeID]
		in.Edges[i].ToNodeID = oldToNew[in.Edges[i].ToNodeID]
	}
	if err := b.store.CreateEdges(in.Edges); err != nil {
		return fmt.Errorf("create edges: %w", err)
	}
	return nil
}

func (b *BlueprintService) prepareAndValidate(in *BlueprintInput) error {
	for i := range in.Nodes {
		if in.Nodes[i].GateType == "api_hook" && in.Nodes[i].WebhookToken == "" {
			in.Nodes[i].WebhookToken = genToken()
		}
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
	nodes, err := b.store.GetBlueprintNodes(bpID)
	if err != nil {
		return nil, err
	}
	edges, err := b.store.GetBlueprintEdges(bpID)
	if err != nil {
		return nil, err
	}
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
	edges, err := b.store.GetBlueprintEdges(bpID)
	if err != nil {
		return nil, err
	}
	var p []uint
	for _, e := range edges {
		if e.ToNodeID == nodeID {
			p = append(p, e.FromNodeID)
		}
	}
	return p, nil
}
func (b *BlueprintService) GetChildNodeIDs(bpID, nodeID uint) ([]uint, error) {
	edges, err := b.store.GetBlueprintEdges(bpID)
	if err != nil {
		return nil, err
	}
	var c []uint
	for _, e := range edges {
		if e.FromNodeID == nodeID {
			c = append(c, e.ToNodeID)
		}
	}
	return c, nil
}
func (b *BlueprintService) IsSinkNode(bpID, nodeID uint) (bool, error) {
	edges, err := b.store.GetBlueprintEdges(bpID)
	if err != nil {
		return false, err
	}
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
