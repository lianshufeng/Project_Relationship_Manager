import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApartmentOutlined, AppstoreOutlined, BankOutlined, BuildOutlined, CameraOutlined, CarOutlined, DeleteOutlined,
  DownloadOutlined, EditOutlined, EnvironmentOutlined, ExpandOutlined, ExportOutlined, FileTextOutlined,
  FullscreenOutlined, HolderOutlined, IdcardOutlined, ImportOutlined, LeftOutlined, PlusOutlined, ReloadOutlined, RightOutlined,
  SafetyCertificateOutlined, SearchOutlined, TeamOutlined, ToolOutlined, UserOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import {
  Background, BackgroundVariant, Connection, Controls, Edge, Handle, MarkerType, MiniMap, Node,
  Position as FlowPosition, ReactFlow, ReactFlowInstance, ReactFlowProvider, useEdgesState, useNodesState,
} from '@xyflow/react';
import dagre from 'dagre';
import { toPng } from 'html-to-image';
import {
  Alert, App as AntApp, Button, Card, Divider, Drawer, Dropdown, Empty, Form, Input, Modal, Popconfirm,
  Result, Select, Space, Spin, Tabs, Tag, Tooltip, Tree, Typography,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import { entityLabels, isProjectData, normalizeProjectData, relationColors, relationLabels } from './data';
import { ErrorBoundary } from './ErrorBoundary';
import type { Entity, EntityType, ProjectRelationshipData, Relation, RelationType } from './types';
import { collectionByType } from './types';

const { Text, Title } = Typography;
const typeColors: Record<EntityType, string> = { project: '#1677ff', team: '#36cfc9', position: '#597ef7', person: '#13c2c2', product: '#52c41a', deviceType: '#fa8c16', device: '#9254de', area: '#fadb14' };
const deviceCategoryLabels: Record<string, string> = { wearable: '人工佩戴设备', machinery: '机械绑定设备', mobile: '移动设备', fixed: '固定设备' };
const apiBase = '/api/v1';
const narrowViewportQuery = '(max-width: 900px)';

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: '请求失败' })) as { message?: string | string[] };
    const detail = Array.isArray(body.message) ? body.message.join('；') : body.message;
    throw new Error(detail || `请求失败（${response.status}）`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
const iconMap: Record<string, React.ReactNode> = {
  BankOutlined: <BankOutlined />, ApartmentOutlined: <ApartmentOutlined />, TeamOutlined: <TeamOutlined />,
  UserOutlined: <UserOutlined />, IdcardOutlined: <IdcardOutlined />, SafetyCertificateOutlined: <SafetyCertificateOutlined />,
  BuildOutlined: <BuildOutlined />, ToolOutlined: <ToolOutlined />, CarOutlined: <CarOutlined />,
  EnvironmentOutlined: <EnvironmentOutlined />, AppstoreOutlined: <AppstoreOutlined />, FileTextOutlined: <FileTextOutlined />,
  VideoCameraOutlined: <VideoCameraOutlined />,
};

interface GraphNodeData extends Record<string, unknown> { entityType: EntityType; name: string; icon: string; subtitle: string; count: number; selected: boolean; dimmed: boolean }

function EntityNode({ data }: { data: GraphNodeData }) {
  const color = typeColors[data.entityType];
  return <Tooltip title={<><div>{data.name}</div><div>{data.subtitle} · {data.count} 项关联</div></>} placement="top" mouseEnterDelay={.35}><div className={`entity-node ${data.selected ? 'selected' : ''} ${data.dimmed ? 'dimmed' : ''}`} style={{ '--node-color': color } as React.CSSProperties}>
    <Handle type="target" position={FlowPosition.Left} />
    <div className="node-icon">{iconMap[data.icon] ?? <AppstoreOutlined />}</div>
    <div className="node-main">
      <div className="node-kicker">{entityLabels[data.entityType]}</div>
      <div className="node-name">{data.name}</div>
      <div className="node-meta">{data.subtitle} · {data.count} 项关联</div>
    </div>
    <Handle type="source" position={FlowPosition.Right} />
  </div></Tooltip>;
}

const nodeTypes = { entity: EntityNode };

function allEntities(data: ProjectRelationshipData): Array<{ type: EntityType; entity: Entity }> {
  return [{ type: 'project', entity: data.project }, ...data.teams.map(entity => ({ type: 'team' as const, entity })), ...data.positions.map(entity => ({ type: 'position' as const, entity })), ...data.persons.map(entity => ({ type: 'person' as const, entity })), ...data.products.map(entity => ({ type: 'product' as const, entity })), ...data.deviceTypes.map(entity => ({ type: 'deviceType' as const, entity })), ...data.devices.map(entity => ({ type: 'device' as const, entity })), ...data.areas.map(entity => ({ type: 'area' as const, entity }))];
}

function entityIconName(data: ProjectRelationshipData, type: EntityType, entity: Entity) {
  if (type === 'device' && 'deviceTypeId' in entity) return data.deviceTypes.find(deviceType => deviceType.id === entity.deviceTypeId)?.icon ?? 'AppstoreOutlined';
  return 'icon' in entity ? entity.icon : 'AppstoreOutlined';
}

function graphElements(data: ProjectRelationshipData, selectedId: string | null, filter: string) {
  const allowed: Record<string, RelationType[]> = {
    all: Object.keys(relationLabels) as RelationType[], deviceChain: ['contains', 'installed_in', 'covers', 'uses', 'supports', 'holds_position'], organization: ['contains', 'holds_position', 'manages'], product: ['uses'], device: ['depends_on', 'supports'], area: ['installed_in', 'covers'], binding: ['binds_to', 'manages'], selected: Object.keys(relationLabels) as RelationType[],
  };
  let relations = data.relations.filter(rel => allowed[filter].includes(rel.relationType));
  if (filter === 'deviceChain') { const deviceActors = new Set(data.relations.filter(rel => rel.relationType === 'uses' && rel.targetType === 'device').map(rel => rel.sourceId)); relations = relations.filter(rel => (rel.relationType === 'contains' && ((rel.sourceType === 'project' && rel.targetType === 'position') || (rel.sourceType === 'product' && rel.targetType === 'product'))) || ['installed_in', 'covers', 'supports'].includes(rel.relationType) || (rel.relationType === 'uses' && ['device', 'product'].includes(rel.targetType)) || (rel.relationType === 'holds_position' && deviceActors.has(rel.sourceId))); }
  if (filter === 'selected' && selectedId) relations = relations.filter(rel => rel.sourceId === selectedId || rel.targetId === selectedId);
  const related = new Set<string>();
  if (selectedId) {
    related.add(selectedId);
    data.relations.forEach(rel => { if (rel.sourceId === selectedId) related.add(rel.targetId); if (rel.targetId === selectedId) related.add(rel.sourceId); });
  }
  const visibleIds = filter === 'all' || (filter === 'selected' && !selectedId) ? null : new Set(relations.flatMap(rel => [rel.sourceId, rel.targetId]));
  const nodes: Node<GraphNodeData>[] = allEntities(data).filter(({ entity }) => !visibleIds || visibleIds.has(entity.id)).map(({ type, entity }) => {
    const subtitle = type === 'person' ? (data.positions.find(p => 'positionIds' in entity && entity.positionIds.includes(p.id))?.name ?? '未分配岗位') : type === 'device' ? (() => { const deviceType = data.deviceTypes.find(item => item.id === ('deviceTypeId' in entity ? entity.deviceTypeId : '')); const area = data.areas.find(item => item.id === ('areaId' in entity ? entity.areaId : '')); return `${deviceType?.name ?? '未知设备'} · ${area?.name ?? deviceCategoryLabels[deviceType?.category ?? ''] ?? '未分类'}`; })() : type === 'area' ? `${data.devices.filter(device => device.areaId === entity.id).length} 台设备` : entityLabels[type];
    return { id: entity.id, type: 'entity', position: data.settings.positions[entity.id] ?? { x: 0, y: 0 }, data: { entityType: type, name: entity.name, icon: entityIconName(data, type, entity), subtitle, count: data.relations.filter(r => r.sourceId === entity.id || r.targetId === entity.id).length, selected: entity.id === selectedId, dimmed: !!selectedId && !related.has(entity.id) } };
  });
  const edges: Edge[] = relations.map(rel => ({ id: rel.id, source: ['installed_in', 'holds_position'].includes(rel.relationType) ? rel.targetId : rel.sourceId, target: ['installed_in', 'holds_position'].includes(rel.relationType) ? rel.sourceId : rel.targetId, label: rel.relationType === 'installed_in' ? '安装设备' : rel.relationType === 'holds_position' ? '任职人员' : (rel.label ?? relationLabels[rel.relationType]), animated: selectedId === rel.sourceId || selectedId === rel.targetId, style: { stroke: relationColors[rel.relationType], strokeWidth: selectedId === rel.sourceId || selectedId === rel.targetId ? 2.6 : 1.2, opacity: selectedId && rel.sourceId !== selectedId && rel.targetId !== selectedId ? .12 : .72, strokeDasharray: ['binds_to', 'manages', 'covers'].includes(rel.relationType) ? '6 4' : undefined }, labelStyle: { fill: '#9fb3c8', fontSize: 10 }, labelBgStyle: { fill: '#07192c', fillOpacity: .86 }, markerEnd: { type: MarkerType.ArrowClosed, color: relationColors[rel.relationType] } }));
  return { nodes, edges };
}

function layout<T extends Record<string, unknown>>(nodes: Node<T>[], edges: Edge[], direction: 'LR' | 'TB'): Node<T>[] {
  const graph = new dagre.graphlib.Graph(); graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: direction, ranksep: 125, nodesep: 34, edgesep: 18, marginx: 40, marginy: 40 });
  nodes.forEach(node => graph.setNode(node.id, { width: 218, height: 82 }));
  edges.forEach(edge => graph.setEdge(edge.source, edge.target)); dagre.layout(graph);
  return nodes.map(node => { const pos = graph.node(node.id); return { ...node, position: { x: pos.x - 109, y: pos.y - 41 } }; });
}

function AppContent() {
  const { message, modal } = AntApp.useApp();
  const [data, setData] = useState<ProjectRelationshipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const editMode = true;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRelation, setSelectedRelation] = useState<string | null>(null);
  const [filter, setFilter] = useState('deviceChain');
  const [leftPanelVisible, setLeftPanelVisible] = useState(() => !window.matchMedia(narrowViewportQuery).matches);
  const [rightPanelVisible, setRightPanelVisible] = useState(() => !window.matchMedia(narrowViewportQuery).matches);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerTab, setManagerTab] = useState<EntityType>('team');
  const [editor, setEditor] = useState<{ type: EntityType; item?: Entity } | null>(null);
  const [relationEditor, setRelationEditor] = useState<Partial<Relation> | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [form] = Form.useForm();
  const [relationForm] = Form.useForm();
  const fileRef = useRef<HTMLInputElement>(null);
  const flowRef = useRef<ReactFlowInstance<Node<GraphNodeData>, Edge> | null>(null);

  const loadStoredFile = useCallback(async () => {
    const projects = await apiRequest<Array<{ id: string }>>('/projects', { cache: 'no-store' });
    if (!projects.length) return null;
    const value: unknown = await apiRequest(`/projects/${projects[0].id}/graph`, { cache: 'no-store' });
    if (!isProjectData(value)) throw new Error('项目数据文件结构无效');
    if (value.dataRevision !== 16) throw new Error('项目数据版本不匹配');
    return normalizeProjectData(value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          const loaded = await loadStoredFile();
          if (!cancelled) { setData(loaded); setLoadError(null); setLoading(false); }
          return;
        } catch {
          if (attempt < 7) { await new Promise(resolve => window.setTimeout(resolve, 1500)); continue; }
          if (!cancelled) { setLoadError('无法从 MongoDB 服务载入项目数据'); setLoading(false); message.error('数据载入失败'); }
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [loadStoredFile, message]);

  const elements = useMemo(() => data ? graphElements(data, selectedId, filter) : { nodes: [], edges: [] }, [data, selectedId, filter]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<GraphNodeData>>(elements.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(elements.edges);
  useEffect(() => { const placed = layout(elements.nodes, elements.edges, data?.settings.layoutDirection ?? 'LR').map(node => ({ ...node, position: data?.settings.positions[node.id] ?? node.position })); setNodes(placed); setEdges(elements.edges); }, [data?.settings.layoutDirection, data?.settings.positions, elements, setEdges, setNodes]);
  useEffect(() => { const timer = window.setTimeout(() => flowRef.current?.fitView({ padding: .12, duration: 350 }), 260); return () => window.clearTimeout(timer); }, [leftPanelVisible, rightPanelVisible]);
  useEffect(() => {
    const media = window.matchMedia(narrowViewportQuery);
    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (event.matches) { setLeftPanelVisible(false); setRightPanelVisible(false); }
    };
    media.addEventListener('change', handleViewportChange);
    return () => media.removeEventListener('change', handleViewportChange);
  }, []);

  const update = useCallback((next: ProjectRelationshipData) => { setData(next); }, []);
  const performLayout = async () => { if (!data) return; const placed = layout(nodes, edges, data.settings.layoutDirection); setNodes(placed); try { await apiRequest(`/projects/${data.project.id}/layouts`, { method: 'PATCH', body: JSON.stringify({ positions: placed.map(node => ({ entityId: node.id, x: node.position.x, y: node.position.y })) }) }); const positions = { ...data.settings.positions, ...Object.fromEntries(placed.map(node => [node.id, node.position])) }; setData({ ...data, settings: { ...data.settings, positions } }); message.success('自动布局已同步'); } catch (error) { message.error(error instanceof Error ? error.message : '自动布局同步失败'); } requestAnimationFrame(() => flowRef.current?.fitView({ padding: .14, duration: 500 })); };
  const toggleLeftPanel = () => setLeftPanelVisible(visible => { const next = !visible; if (next && window.matchMedia(narrowViewportQuery).matches) setRightPanelVisible(false); return next; });
  const toggleRightPanel = () => setRightPanelVisible(visible => { const next = !visible; if (next && window.matchMedia(narrowViewportQuery).matches) setLeftPanelVisible(false); return next; });
  const entityIndex = useMemo(() => new Map((data ? allEntities(data) : []).map(item => [item.entity.id, item])), [data]);
  const selected = selectedId ? entityIndex.get(selectedId) : undefined;
  const selectedRel = data?.relations.find(rel => rel.id === selectedRelation);

  const treeData = useMemo<DataNode[]>(() => {
    if (!data) return [];
    const peopleAt = (positionId: string): DataNode[] => data.persons.filter(person => person.positionIds.includes(positionId)).map(person => ({ key: person.id, title: person.name, icon: <UserOutlined /> }));
    const positionNodes: DataNode[] = [...data.positions].sort((a, b) => a.sort - b.sort).map(position => ({ key: position.id, title: position.name, icon: <IdcardOutlined />, children: peopleAt(position.id) }));
    const areaNodes = data.areas.map(area => ({ key: area.id, title: `${area.name}（${data.devices.filter(device => device.areaId === area.id).length}）`, icon: <EnvironmentOutlined />, children: data.devices.filter(device => device.areaId === area.id).map(device => ({ key: device.id, title: device.name, icon: <VideoCameraOutlined /> })) }));
    return [{ key: data.project.id, title: data.project.name, icon: <BankOutlined />, children: [...positionNodes, { key: 'group-areas', title: '施工区域', icon: <EnvironmentOutlined />, children: areaNodes }] }];
  }, [data]);

  const locate = (value: string) => { if (!entityIndex.has(value)) return; setSelectedId(value); setSelectedRelation(null); requestAnimationFrame(() => { const node = nodes.find(item => item.id === value); if (node) flowRef.current?.setCenter(node.position.x + 109, node.position.y + 41, { zoom: 1.3, duration: 450 }); }); };
  const entityOptions = (data ? allEntities(data) : []).map(item => ({ value: item.entity.id, label: `${entityLabels[item.type]} · ${item.entity.name}` }));

  const exportJson = async () => { if (!data) return; try { const value = await apiRequest<ProjectRelationshipData>(`/projects/${data.project.id}/export`, { cache: 'no-store' }); const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `项目部关系配置-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.json`; link.click(); URL.revokeObjectURL(link.href); message.success('JSON 配置已导出'); } catch (error) { message.error(error instanceof Error ? error.message : 'JSON 导出失败'); } };
  const exportCompleteGraph = async () => {
    const viewport = document.querySelector<HTMLElement>('.graph-panel .react-flow__viewport');
    const flow = flowRef.current;
    if (!viewport || !flow || !nodes.length) return message.warning('当前没有可导出的关系图');
    try {
      await document.fonts.ready;
      const bounds = flow.getNodesBounds(nodes);
      const padding = 96;
      const width = Math.ceil(bounds.width + padding * 2);
      const height = Math.ceil(bounds.height + padding * 2);
      const pixelRatio = Math.max(1, Math.min(2, 16384 / width, 16384 / height));
      const image = await toPng(viewport, {
        backgroundColor: '#061426', cacheBust: true, pixelRatio, width, height,
        style: { width: `${width}px`, height: `${height}px`, transform: `translate(${padding - bounds.x}px, ${padding - bounds.y}px) scale(1)` },
      });
      const link = document.createElement('a'); link.href = image; link.download = `${data?.project.name ?? '项目关系图'}-完整关系图-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.png`; link.click();
      message.success(`完整关系图已导出（${Math.round(width * pixelRatio)} × ${Math.round(height * pixelRatio)}）`);
    } catch { message.error('完整关系图导出失败'); }
  };
  const importJson = async (file: File) => { try { const value: unknown = JSON.parse(await file.text()); if (!isProjectData(value)) throw new Error('配置结构无效'); await apiRequest(`/projects/${value.project.id}/import`, { method: 'POST', body: JSON.stringify(value) }); const loaded = await loadStoredFile(); if (!loaded) throw new Error('导入后未读取到项目数据'); setData(loaded); setLoadError(null); setSelectedId(null); message.success('JSON 导入成功，关系图已更新'); } catch (error) { message.error(error instanceof Error ? error.message : '导入失败：请选择有效的 JSON 文件'); } };
  const createBlankProject = async () => { try { await apiRequest('/projects', { method: 'POST', body: JSON.stringify({ name: '未命名项目部' }) }); const loaded = await loadStoredFile(); if (!loaded) throw new Error('项目创建后读取失败'); setData(loaded); setLoadError(null); message.success('空白项目已创建'); } catch (error) { message.error(error instanceof Error ? error.message : '项目创建失败'); } };
  const openClearConfirm = () => { setClearConfirmText(''); setClearConfirmOpen(true); };
  const clearProjectData = async () => { if (!data || clearConfirmText.trim() !== data.project.name) return; try { await apiRequest(`/projects/${data.project.id}`, { method: 'DELETE' }); setClearConfirmOpen(false); setClearConfirmText(''); setData(null); setSelectedId(null); setSelectedRelation(null); setManagerOpen(false); message.success('当前项目数据已清空'); } catch (error) { message.error(error instanceof Error ? error.message : '清空数据失败'); } };
  const jsonFileInput = <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importJson(file); event.target.value = ''; }} />;
  const reloadStoredData = () => modal.confirm({ title: '重新加载服务器数据？', content: '页面将重新读取 MongoDB 中的最新数据。', okText: '重新加载', cancelText: '取消', onOk: async () => { const value = await loadStoredFile(); setData(value); setSelectedId(null); setSelectedRelation(null); message.success('已重新加载服务器数据'); } });

  const populateEntityForm = () => {
    if (!editor) return;
    form.resetFields();
    const defaults: Record<string, unknown> = { name: '', icon: 'AppstoreOutlined', sort: 99, projectId: data?.project.id };
    const values = editor.item ? { ...editor.item } : defaults;
    if (editor.type === 'device' && editor.item && data) {
      const installation = data.relations.find(rel => rel.sourceType === 'device' && rel.sourceId === editor.item?.id && rel.targetType === 'area' && rel.relationType === 'installed_in');
      form.setFieldsValue({ ...values, areaId: installation?.targetId ?? ('areaId' in editor.item ? editor.item.areaId : undefined) });
      return;
    }
    if (editor.type === 'product' && editor.item && data) {
      const parentRelation = data.relations.find(rel => rel.sourceType === 'product' && rel.targetType === 'product' && rel.targetId === editor.item?.id && rel.relationType === 'contains');
      form.setFieldsValue({ ...values, parentProductId: parentRelation?.sourceId });
      return;
    }
    form.setFieldsValue(values);
  };
  const openEditor = (type: EntityType, item?: Entity) => { setEditor({ type, item }); };
  const saveEntity = async () => {
    if (!data || !editor) return;
    const values = await form.validateFields();
    try {
      const { projectId: _projectId, ...payload } = values;
      const endpoint = editor.item
        ? `/projects/${data.project.id}/entities/${editor.item.id}`
        : `/projects/${data.project.id}/entities`;
      await apiRequest(endpoint, {
        method: editor.item ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...payload, entityType: editor.type }),
      });
      setData(await loadStoredFile());
      setEditor(null);
      message.success(editor.item ? '实体已更新并同步' : '实体已新增并同步');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '实体保存失败');
    }
  };
  const deleteEntity = (type: EntityType, entityId: string) => { if (!data || type === 'project') return; if (type === 'position') { const assigned = data.persons.filter(person => person.positionIds.includes(entityId)); if (assigned.length) { message.warning(`该岗位下还有 ${assigned.length} 名人员，请先调整人员岗位`); return; } } const relatedCount = data.relations.filter(rel => rel.sourceId === entityId || rel.targetId === entityId).length; modal.confirm({ title: `删除${entityLabels[type]}？`, content: relatedCount ? `该对象关联 ${relatedCount} 条关系，确认后将由服务端校验并清理。` : '此操作无法撤销。', okText: '删除', okButtonProps: { danger: true }, onOk: async () => { try { await apiRequest(`/projects/${data.project.id}/entities/${entityId}`, { method: 'DELETE' }); setData(await loadStoredFile()); setSelectedId(null); message.success('对象及关联数据已删除'); } catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); throw error; } } }); };

  const recommendRelation = (sourceId?: string, targetId?: string): RelationType => { const source = sourceId ? entityIndex.get(sourceId)?.type : undefined; const target = targetId ? entityIndex.get(targetId)?.type : undefined; if ((source === 'position' || source === 'person') && (target === 'product' || target === 'device')) return 'uses'; if (source === 'person' && target === 'position') return 'holds_position'; if (source === 'product' && target === 'deviceType') return 'depends_on'; if (source === 'device' && target === 'product') return 'supports'; if (source === 'device' && target === 'area') return 'installed_in'; if (source === 'device') return 'binds_to'; return 'contains'; };
  const openRelationEditor = (relation?: Partial<Relation>) => { setRelationEditor(relation ?? { sourceType: 'position', targetType: 'product', relationType: 'uses' }); };
  const saveRelation = async () => { if (!data) return; const values = await relationForm.validateFields(); const source = entityIndex.get(values.sourceId); const target = entityIndex.get(values.targetId); if (!source || !target) return message.error('请选择有效的源对象和目标对象'); try { const endpoint = relationEditor?.id ? `/projects/${data.project.id}/relations/${relationEditor.id}` : `/projects/${data.project.id}/relations`; await apiRequest(endpoint, { method: relationEditor?.id ? 'PATCH' : 'POST', body: JSON.stringify(values) }); setData(await loadStoredFile()); setRelationEditor(null); message.success('关系已同步'); } catch (error) { message.error(error instanceof Error ? error.message : '关系保存失败'); } };
  const deleteRelation = async (relationId: string) => { if (!data) return; try { await apiRequest(`/projects/${data.project.id}/relations/${relationId}`, { method: 'DELETE' }); setData(await loadStoredFile()); setSelectedRelation(null); message.success('关系已删除'); } catch (error) { message.error(error instanceof Error ? error.message : '关系删除失败'); } };
  const reorderEntityRelations = async (entityId: string, draggedId: string, targetId: string) => { if (!data || draggedId === targetId) return; const related = data.relations.filter(rel => rel.sourceId === entityId || rel.targetId === entityId); const fromIndex = related.findIndex(rel => rel.id === draggedId); const targetIndex = related.findIndex(rel => rel.id === targetId); if (fromIndex < 0 || targetIndex < 0) return; const reordered = [...related]; const [dragged] = reordered.splice(fromIndex, 1); reordered.splice(targetIndex, 0, dragged); const relatedIds = new Set(related.map(rel => rel.id)); let cursor = 0; const relations = data.relations.map(rel => relatedIds.has(rel.id) ? reordered[cursor++] : rel); try { await apiRequest(`/projects/${data.project.id}/relations/order`, { method: 'PATCH', body: JSON.stringify({ relationIds: relations.map(relation => relation.id) }) }); const nextData = { ...data, relations }; const nextElements = graphElements(nextData, selectedId, filter); const placed = layout(nextElements.nodes, nextElements.edges, data.settings.layoutDirection); try { if (placed.length) await apiRequest(`/projects/${data.project.id}/layouts`, { method: 'PATCH', body: JSON.stringify({ positions: placed.map(node => ({ entityId: node.id, x: node.position.x, y: node.position.y })) }) }); const positions = { ...data.settings.positions, ...Object.fromEntries(placed.map(node => [node.id, node.position])) }; update({ ...nextData, settings: { ...data.settings, positions } }); setNodes(placed); setEdges(nextElements.edges); message.success('关系顺序及图谱布局已同步'); } catch (error) { update(nextData); message.warning(error instanceof Error ? `关系顺序已同步，但图谱布局同步失败：${error.message}` : '关系顺序已同步，但图谱布局同步失败'); } } catch (error) { message.error(error instanceof Error ? error.message : '关系排序失败'); } };
  const onConnect = (connection: Connection) => { if (!editMode || !connection.source || !connection.target) return; const source = entityIndex.get(connection.source); const target = entityIndex.get(connection.target); const relationType = recommendRelation(connection.source, connection.target); openRelationEditor({ sourceId: connection.source, targetId: connection.target, sourceType: source?.type, targetType: target?.type, relationType, label: relationLabels[relationType] }); };

  if (loading) return <div className="loading"><Spin size="large" /><Text>载入中</Text></div>;
  if (!data) return loadError
    ? <Result status="error" title="数据载入失败" subTitle={loadError} extra={<Button type="primary" onClick={() => location.reload()}>重新加载</Button>} />
    : <><Result status="info" title="暂无项目数据" subTitle="数据库当前为空，你可以创建空白项目或导入已有 JSON 配置。" extra={<Space><Button type="primary" icon={<PlusOutlined />} onClick={() => void createBlankProject()}>创建空白项目</Button><Button icon={<ImportOutlined />} onClick={() => fileRef.current?.click()}>导入 JSON</Button></Space>} />{jsonFileInput}</>;
  const managerTypes: EntityType[] = ['team', 'position', 'person', 'product', 'deviceType', 'device', 'area'];
  const managerList = managerTab === 'project' ? [] : data[collectionByType[managerTab]] as unknown as Entity[];

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><BankOutlined /></div><div><Title level={4}>{data.project.name}</Title><Text>组织 · 区域 · 设备 · 产品关系中枢</Text></div></div>
      <div className="toolbar">
        <Select value={filter} onChange={setFilter} className="filter-select" options={[{ value: 'deviceChain', label: '设备全链路' }, { value: 'area', label: '只看区域与设备' }, { value: 'binding', label: '只看设备绑定' }, { value: 'product', label: '只看岗位与系统功能' }, { value: 'device', label: '只看设备与系统功能' }, { value: 'organization', label: '只看组织关系' }, { value: 'all', label: '全部关系' }, { value: 'selected', label: '只看当前选中对象' }]} />
        <Select showSearch allowClear placeholder="搜索区域、设备、人员或产品" suffixIcon={<SearchOutlined />} className="search-select" options={entityOptions} filterOption={(input, option) => String(option?.label).toLowerCase().includes(input.toLowerCase())} onSelect={locate} />
        <Tooltip title="自动布局"><Button icon={<ApartmentOutlined />} onClick={performLayout} /></Tooltip>
        <Tooltip title="适应画布"><Button icon={<ExpandOutlined />} onClick={() => flowRef.current?.fitView({ padding: .12, duration: 400 })} /></Tooltip>
        <Tooltip title="全屏"><Button icon={<FullscreenOutlined />} onClick={() => document.documentElement.requestFullscreen()} /></Tooltip>
        <Button icon={<CameraOutlined />} onClick={() => void exportCompleteGraph()}>导出完整关系图</Button>
        <Dropdown trigger={['click']} menu={{ items: [{ key: 'import', label: '导入 JSON', icon: <ImportOutlined /> }, { key: 'export', label: '导出 JSON', icon: <ExportOutlined /> }, { key: 'reload', label: '重新加载已保存数据', icon: <ReloadOutlined /> }, { type: 'divider' }, { key: 'clear', label: '清空当前项目数据', icon: <DeleteOutlined />, danger: true }], onClick: ({ key }) => key === 'import' ? fileRef.current?.click() : key === 'export' ? void exportJson() : key === 'clear' ? openClearConfirm() : reloadStoredData() }}><Button icon={<DownloadOutlined />}>数据</Button></Dropdown>
        {jsonFileInput}
      </div>
    </header>

    <main className={`workspace ${leftPanelVisible ? '' : 'left-collapsed'} ${rightPanelVisible ? '' : 'right-collapsed'}`}>
      <aside className={`left-panel panel ${leftPanelVisible ? '' : 'is-collapsed'}`} aria-hidden={!leftPanelVisible}>
        <div className="panel-heading"><div><Text className="eyebrow">PROJECT STRUCTURE</Text><Title level={5}>项目结构</Title></div></div>
        <Tree showIcon defaultExpandedKeys={[data.project.id, 'group-areas', ...data.areas.map(area => area.id)]} treeData={treeData} selectedKeys={selectedId ? [selectedId] : []} onSelect={keys => keys[0] && locate(String(keys[0]))} />
        <Divider />
        <div className="summary-grid"><div><strong>{data.teams.length}</strong><span>团队</span></div><div><strong>{data.persons.length}</strong><span>人员</span></div><div><strong>{data.areas.length}</strong><span>区域</span></div><div><strong>{data.devices.length}</strong><span>设备</span></div></div>
        {editMode && <div className="left-panel-actions"><Button icon={<EditOutlined />} onClick={() => openEditor('project', data.project)}>项目信息</Button><Button icon={<AppstoreOutlined />} onClick={() => setManagerOpen(true)}>实体管理</Button></div>}
      </aside>

      <section className="graph-panel">
        <Tooltip title={leftPanelVisible ? '隐藏组织架构' : '显示组织架构'} placement="right">
          <Button className="panel-toggle panel-toggle-left" shape="circle" size="small" aria-label={leftPanelVisible ? '隐藏组织架构' : '显示组织架构'} icon={leftPanelVisible ? <LeftOutlined /> : <RightOutlined />} onClick={toggleLeftPanel} />
        </Tooltip>
        <Tooltip title={rightPanelVisible ? '隐藏详情面板' : '显示详情面板'} placement="left">
          <Button className="panel-toggle panel-toggle-right" shape="circle" size="small" aria-label={rightPanelVisible ? '隐藏详情面板' : '显示详情面板'} icon={rightPanelVisible ? <RightOutlined /> : <LeftOutlined />} onClick={toggleRightPanel} />
        </Tooltip>
        <div className="graph-caption"><div><Text className="eyebrow">RELATIONSHIP CANVAS</Text><strong>{filter === 'all' ? '全域关系视图' : filter === 'deviceChain' ? '设备业务全链路' : filter === 'area' ? '区域设备部署视图' : '聚焦关系视图'}</strong></div><div className="legend">{(['uses', 'installed_in', 'supports', 'binds_to'] as RelationType[]).map(type => <span key={type}><i style={{ background: relationColors[type] }} />{relationLabels[type]}</span>)}</div></div>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onInit={instance => { flowRef.current = instance; setTimeout(() => instance.fitView({ padding: .1 }), 80); }} onNodeClick={(_, node) => { setSelectedId(node.id); setSelectedRelation(null); }} onNodeDoubleClick={(_, node) => { const item = entityIndex.get(node.id); if (item) openEditor(item.type, item.entity); }} onEdgeClick={(_, edge) => { setSelectedRelation(edge.id); setSelectedId(null); }} onConnect={onConnect} nodesConnectable nodesDraggable onPaneClick={() => { setSelectedId(null); setSelectedRelation(null); }} onNodeDragStop={(_, node) => { if (!data) return; const next = { ...data, settings: { ...data.settings, positions: { ...data.settings.positions, [node.id]: node.position } } }; update(next); void apiRequest(`/projects/${data.project.id}/layouts/${node.id}`, { method: 'PATCH', body: JSON.stringify(node.position) }).catch(error => message.error(error instanceof Error ? error.message : '节点布局同步失败')); }} minZoom={.08} maxZoom={2.4} fitView>
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(84,151,255,.18)" /><MiniMap nodeColor={node => typeColors[(node.data as GraphNodeData).entityType]} maskColor="rgba(4,15,28,.74)" /><Controls />
        </ReactFlow>
        {!nodes.length && <Empty className="graph-empty" description="暂无关系数据" />}
      </section>

      <aside className={`right-panel panel ${rightPanelVisible ? '' : 'is-collapsed'}`} aria-hidden={!rightPanelVisible}>
        <div className="panel-heading"><div><Text className="eyebrow">INSPECTOR</Text><Title level={5}>{selected ? '实体详情' : selectedRel ? '关系详情' : '详情'}</Title></div></div>
        {selected ? <EntityDetails data={data} type={selected.type} entity={selected.entity} onLocate={locate} onEdit={() => openEditor(selected.type, selected.entity)} editMode={editMode} onAddRelation={() => openRelationEditor({ sourceId: selected.entity.id, sourceType: selected.type })} onDeleteRelation={deleteRelation} onReorderRelations={(draggedId, targetId) => reorderEntityRelations(selected.entity.id, draggedId, targetId)} /> : selectedRel ? <RelationDetails data={data} relation={selectedRel} index={entityIndex} editMode={editMode} onEdit={() => openRelationEditor(selectedRel)} onDelete={() => deleteRelation(selectedRel.id)} /> : <div className="detail-placeholder"><div className="orbit"><span /></div><Title level={5}>选择任意节点</Title><Text>查看区域内安装设备、设备信息、责任组织及产品能力。点击节点后，无关关系会自动淡化。</Text></div>}
      </aside>
    </main>

    <Drawer title="实体管理" width={650} open={managerOpen} onClose={() => setManagerOpen(false)} extra={editMode && <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(managerTab)}>新增{entityLabels[managerTab]}</Button>}>
      <Tabs activeKey={managerTab} onChange={key => setManagerTab(key as EntityType)} items={managerTypes.map(type => ({ key: type, label: entityLabels[type] }))} />
      <div className="entity-list">{managerList.map(entity => <Card key={entity.id} size="small"><div className="entity-list-row"><div className="list-icon" style={{ color: typeColors[managerTab] }}>{iconMap[entityIconName(data, managerTab, entity)] ?? <AppstoreOutlined />}</div><div className="list-content"><strong>{entity.name}</strong><Text>{entity.id}</Text></div>{editMode && <Space><Button type="text" icon={<EditOutlined />} onClick={() => openEditor(managerTab, entity)} /><Popconfirm title="确定删除？" onConfirm={() => deleteEntity(managerTab, entity.id)}><Button danger type="text" icon={<DeleteOutlined />} /></Popconfirm></Space>}</div></Card>)}</div>
    </Drawer>

    <Modal title={`${editor?.item ? '编辑' : '新增'}${editor ? entityLabels[editor.type] : ''}`} open={!!editor} onCancel={() => setEditor(null)} onOk={() => void saveEntity()} afterOpenChange={open => { if (open) populateEntityForm(); }} okText="保存" cancelText="取消" destroyOnHidden>
      {editor && <EntityForm form={form} type={editor.type} data={data} />}
    </Modal>
    <Modal title={relationEditor?.id ? '编辑关系' : '新增关系'} open={!!relationEditor} onCancel={() => setRelationEditor(null)} onOk={() => void saveRelation()} afterOpenChange={open => { if (open && relationEditor) { relationForm.resetFields(); relationForm.setFieldsValue(relationEditor); } }} okText="保存关系" cancelText="取消" destroyOnHidden>
      <Form form={relationForm} layout="vertical" onValuesChange={(changed) => { if (changed.sourceId || changed.targetId) { const current = relationForm.getFieldsValue(); const relType = recommendRelation(current.sourceId, current.targetId); relationForm.setFieldsValue({ relationType: relType, label: relationLabels[relType] }); } }}>
        <Form.Item name="sourceId" label="源对象" rules={[{ required: true }]}><Select showSearch options={entityOptions} optionFilterProp="label" /></Form.Item>
        <Form.Item name="relationType" label="关系类型" rules={[{ required: true }]}><Select options={Object.entries(relationLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Form.Item name="targetId" label="目标对象" rules={[{ required: true }]}><Select showSearch options={entityOptions} optionFilterProp="label" /></Form.Item>
        <Form.Item name="label" label="关系名称"><Input placeholder="默认使用关系类型名称" /></Form.Item>
      </Form>
    </Modal>
    <Modal title="确认清空当前项目数据？" open={clearConfirmOpen} onCancel={() => { setClearConfirmOpen(false); setClearConfirmText(''); }} closable={false} maskClosable={false} footer={<Space><Button onClick={() => { setClearConfirmOpen(false); setClearConfirmText(''); }}>取消</Button><Button icon={<ExportOutlined />} onClick={() => void exportJson()}>先导出 JSON 备份</Button><Button danger type="primary" icon={<DeleteOutlined />} disabled={clearConfirmText.trim() !== data.project.name} onClick={() => void clearProjectData()}>永久清空</Button></Space>}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert type="error" showIcon message="清空后无法撤回" description="将永久删除当前项目的全部实体、关系、布局和项目设置。此操作无法撤销，请先导出 JSON 备份。" />
        <Text>请输入项目名称 <Text strong>{data.project.name}</Text> 以确认操作：</Text>
        <Input status={clearConfirmText && clearConfirmText.trim() !== data.project.name ? 'error' : undefined} value={clearConfirmText} onChange={event => setClearConfirmText(event.target.value)} placeholder={data.project.name} autoComplete="off" />
      </Space>
    </Modal>
  </div>;
}

function EntityForm({ form, type, data }: { form: ReturnType<typeof Form.useForm>[0]; type: EntityType; data: ProjectRelationshipData }) {
  const iconOptions = ['BankOutlined', 'ApartmentOutlined', 'TeamOutlined', 'UserOutlined', 'IdcardOutlined', 'SafetyCertificateOutlined', 'BuildOutlined', 'ToolOutlined', 'CarOutlined', 'EnvironmentOutlined', 'AppstoreOutlined', 'FileTextOutlined', 'VideoCameraOutlined'].map(value => ({ value, label: value }));
  const selectedDeviceTypeId = Form.useWatch('deviceTypeId', form);
  const currentProductId = Form.useWatch('id', form);
  const isFixedDevice = data.deviceTypes.find(item => item.id === selectedDeviceTypeId)?.category === 'fixed';
  return <Form form={form} layout="vertical" preserve={false}>
    <Form.Item name="name" label={type === 'project' ? '项目名称' : '名称'} rules={[{ required: true, message: '请输入名称' }]}><Input autoFocus /></Form.Item>
    {type !== 'device' && <Form.Item name="icon" label="图标"><Select showSearch options={iconOptions} optionRender={option => <Space>{iconMap[String(option.value)]}{option.label}</Space>} /></Form.Item>}
    {type === 'team' && <><Form.Item name="type" label="团队类型" rules={[{ required: true }]}><Select options={['project_management', 'construction', 'supervision', 'owner', 'design', 'subcontractor', 'other'].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="parentId" label="上级团队"><Select allowClear options={data.teams.map(team => ({ value: team.id, label: team.name }))} /></Form.Item><Form.Item name="projectId" hidden><Input /></Form.Item><Form.Item name="sort" hidden><Input /></Form.Item></>}
    {type === 'position' && <><Form.Item name="projectId" label="所属项目部" rules={[{ required: true }]}><Select options={[{ value: data.project.id, label: data.project.name }]} /></Form.Item><Form.Item name="teamId" label="所属团队（属性）"><Select allowClear options={data.teams.map(team => ({ value: team.id, label: team.name }))} /></Form.Item><Form.Item name="sort" hidden><Input /></Form.Item></>}
    {type === 'person' && <><Form.Item name="positionIds" label="担任岗位" rules={[{ required: true, type: 'array', min: 1, message: '人员必须至少属于一个岗位' }]}><Select mode="multiple" options={data.positions.map(position => ({ value: position.id, label: position.name }))} /></Form.Item><Form.Item name="phone" label="联系电话"><Input /></Form.Item></>}
    {type === 'product' && <><Form.Item name="id" hidden><Input /></Form.Item><Form.Item name="parentProductId" label="上级系统"><Select allowClear placeholder="无上级系统" options={data.products.filter(product => product.id !== currentProductId).map(product => ({ value: product.id, label: product.name }))} /></Form.Item></>}
    {type === 'deviceType' && <Form.Item name="category" label="设备分类" rules={[{ required: true }]}><Select options={[{ value: 'wearable', label: '人工佩戴设备' }, { value: 'machinery', label: '机械绑定设备' }, { value: 'mobile', label: '移动设备' }, { value: 'fixed', label: '固定设备' }]} /></Form.Item>}
    {type === 'device' && <><Form.Item name="deviceTypeId" label="设备类型" rules={[{ required: true }]}><Select options={data.deviceTypes.map(item => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="areaId" label="安装区域" hidden={!isFixedDevice} rules={isFixedDevice ? [{ required: true, message: '固定设备必须选择安装区域' }] : []}><Select showSearch options={data.areas.map(area => ({ value: area.id, label: area.name }))} /></Form.Item><Form.Item name="code" label="设备编码"><Input /></Form.Item></>}
    {type === 'area' && <Form.Item name="projectId" hidden><Input /></Form.Item>}
    {type === 'project' && <><Form.Item name="shortName" label="项目简称"><Input /></Form.Item><Form.Item name="address" label="项目地址"><Input /></Form.Item></>}
    <Form.Item name="description" label={type === 'project' ? '项目介绍' : '说明'}><Input.TextArea rows={3} /></Form.Item>
  </Form>;
}

function EntityDetails({ data, type, entity, onLocate, onEdit, editMode, onAddRelation, onDeleteRelation, onReorderRelations }: { data: ProjectRelationshipData; type: EntityType; entity: Entity; onLocate: (id: string) => void; onEdit: () => void; editMode: boolean; onAddRelation: () => void; onDeleteRelation: (relationId: string) => void; onReorderRelations: (draggedId: string, targetId: string) => void }) {
  const relations = data.relations.filter(rel => rel.sourceId === entity.id || rel.targetId === entity.id);
  const index = new Map(allEntities(data).map(item => [item.entity.id, item]));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  return <div className="detail-content"><Button className="entity-detail-edit" icon={<EditOutlined />} onClick={onEdit}>编辑</Button><div className="detail-icon" style={{ color: typeColors[type] }}>{iconMap[entityIconName(data, type, entity)] ?? <AppstoreOutlined />}</div><Tag color={typeColors[type]}>{entityLabels[type]}</Tag><Title level={4}>{entity.name}</Title>{'description' in entity && entity.description && <Text>{entity.description}</Text>}
    {'phone' in entity && entity.phone && <div className="detail-field"><span>联系电话</span><strong>{entity.phone}</strong></div>}
    {'address' in entity && entity.address && <div className="detail-field"><span>项目地址</span><strong>{entity.address}</strong></div>}
    {'areaId' in entity && <div className="detail-field"><span>安装区域</span><strong>{data.areas.find(area => area.id === entity.areaId)?.name ?? '未分配'}</strong></div>}
    {'code' in entity && entity.code && <div className="detail-field"><span>设备编码</span><strong>{entity.code}</strong></div>}
    <Divider>关联对象 · {relations.length}</Divider>
    <div className="relation-list">{relations.length ? relations.map(rel => { const otherId = rel.sourceId === entity.id ? rel.targetId : rel.sourceId; const other = index.get(otherId); const otherName = other?.entity.name ?? '未知对象'; const displayLabel = rel.relationType === 'installed_in' && rel.targetId === entity.id ? '安装设备' : rel.relationType === 'holds_position' && rel.targetId === entity.id ? '任职人员' : (rel.label ?? relationLabels[rel.relationType]); return <Tooltip key={rel.id} title={<><div>{displayLabel}</div><div>{otherName}</div></>} placement="left" mouseEnterDelay={.35}><div className={`relation-item ${draggingId === rel.id ? 'dragging' : ''} ${dragOverId === rel.id ? 'drag-over' : ''}`} draggable={editMode} onDragStart={event => { setDraggingId(rel.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', rel.id); }} onDragEnter={() => { if (draggingId && draggingId !== rel.id) setDragOverId(rel.id); }} onDragOver={event => { if (editMode) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={event => { event.preventDefault(); const draggedRelationId = event.dataTransfer.getData('text/plain') || draggingId; if (draggedRelationId && draggedRelationId !== rel.id) onReorderRelations(draggedRelationId, rel.id); setDraggingId(null); setDragOverId(null); }} onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}>
      {editMode && <span className="relation-drag-handle" title="拖拽调整顺序"><HolderOutlined /></span>}
      <button className="relation-main" onClick={() => onLocate(otherId)}><i style={{ background: relationColors[rel.relationType] }} /><span><small>{displayLabel}</small><strong>{otherName}</strong></span><ExportOutlined /></button>
      {editMode && <Popconfirm title="删除这条关系？" description={`${displayLabel}：${otherName}`} okText="删除关系" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => onDeleteRelation(rel.id)}><Button className="relation-delete" danger type="text" size="small" aria-label={`删除关系 ${otherName}`} title="删除关系" icon={<DeleteOutlined />} onClick={event => event.stopPropagation()} /></Popconfirm>}
    </div></Tooltip>; }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联" />}</div>
    {editMode && <div className="detail-actions"><Button type="primary" icon={<PlusOutlined />} onClick={onAddRelation}>新增关系</Button></div>}
  </div>;
}

function RelationDetails({ relation, index, editMode, onEdit, onDelete }: { data: ProjectRelationshipData; relation: Relation; index: Map<string, { type: EntityType; entity: Entity }>; editMode: boolean; onEdit: () => void; onDelete: () => void }) {
  const source = index.get(relation.sourceId); const target = index.get(relation.targetId);
  return <div className="detail-content"><div className="detail-icon" style={{ color: relationColors[relation.relationType] }}><ExportOutlined /></div><Tag color={relationColors[relation.relationType]}>关系</Tag><Title level={4}>{relation.label ?? relationLabels[relation.relationType]}</Title><div className="relation-route"><Card size="small"><Text>{source ? entityLabels[source.type] : ''}</Text><strong>{source?.entity.name}</strong></Card><span style={{ color: relationColors[relation.relationType] }}>→</span><Card size="small"><Text>{target ? entityLabels[target.type] : ''}</Text><strong>{target?.entity.name}</strong></Card></div><div className="detail-field"><span>关系类型</span><strong>{relationLabels[relation.relationType]}</strong></div>{editMode && <div className="detail-actions"><Button type="primary" icon={<EditOutlined />} onClick={onEdit}>编辑关系</Button><Button danger icon={<DeleteOutlined />} onClick={onDelete}>删除关系</Button></div>}</div>;
}

export default function Application() { return <ErrorBoundary><ReactFlowProvider><AppContent /></ReactFlowProvider></ErrorBoundary>; }
