import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApartmentOutlined, AppstoreOutlined, BankOutlined, BuildOutlined, CameraOutlined, CarOutlined, DeleteOutlined,
  DownloadOutlined, EditOutlined, EnvironmentOutlined, ExpandOutlined, ExportOutlined, FileTextOutlined,
  FullscreenOutlined, HolderOutlined, IdcardOutlined, ImportOutlined, LeftOutlined, PlusOutlined, ReloadOutlined, RightOutlined, SaveOutlined,
  SafetyCertificateOutlined, SearchOutlined, TeamOutlined, ToolOutlined, UserOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import {
  Background, BackgroundVariant, Connection, Controls, Edge, Handle, MarkerType, MiniMap, Node,
  Position as FlowPosition, ReactFlow, ReactFlowInstance, ReactFlowProvider, useEdgesState, useNodesState,
} from '@xyflow/react';
import dagre from 'dagre';
import { toPng } from 'html-to-image';
import {
  App as AntApp, Button, Card, Divider, Drawer, Dropdown, Empty, Form, Input, Modal, Popconfirm,
  Result, Select, Space, Spin, Tabs, Tag, Tooltip, Tree, Typography,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import { entityLabels, id, isProjectData, normalizeProjectData, relationColors, relationLabels } from './data';
import { ErrorBoundary } from './ErrorBoundary';
import type { Entity, EntityType, ProjectRelationshipData, Relation, RelationType } from './types';
import { collectionByType } from './types';

const { Text, Title } = Typography;
const typeColors: Record<EntityType, string> = { project: '#1677ff', team: '#36cfc9', position: '#597ef7', person: '#13c2c2', product: '#52c41a', deviceType: '#fa8c16', device: '#9254de', area: '#fadb14' };
const deviceCategoryLabels: Record<string, string> = { wearable: '人工佩戴设备', machinery: '机械绑定设备', mobile: '移动设备', fixed: '固定设备' };
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
  return <div className={`entity-node ${data.selected ? 'selected' : ''} ${data.dimmed ? 'dimmed' : ''}`} style={{ '--node-color': color } as React.CSSProperties}>
    <Handle type="target" position={FlowPosition.Left} />
    <div className="node-icon">{iconMap[data.icon] ?? <AppstoreOutlined />}</div>
    <div className="node-main">
      <div className="node-kicker">{entityLabels[data.entityType]}</div>
      <div className="node-name">{data.name}</div>
      <div className="node-meta">{data.subtitle} · {data.count} 项关联</div>
    </div>
    <Handle type="source" position={FlowPosition.Right} />
  </div>;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const editMode = true;
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRelation, setSelectedRelation] = useState<string | null>(null);
  const [filter, setFilter] = useState('deviceChain');
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerTab, setManagerTab] = useState<EntityType>('team');
  const [editor, setEditor] = useState<{ type: EntityType; item?: Entity } | null>(null);
  const [relationEditor, setRelationEditor] = useState<Partial<Relation> | null>(null);
  const [history, setHistory] = useState<ProjectRelationshipData[]>([]);
  const [future, setFuture] = useState<ProjectRelationshipData[]>([]);
  const [form] = Form.useForm();
  const [relationForm] = Form.useForm();
  const fileRef = useRef<HTMLInputElement>(null);
  const flowRef = useRef<ReactFlowInstance<Node<GraphNodeData>, Edge> | null>(null);
  const storeRevisionRef = useRef(0);

  const loadStoredFile = useCallback(async () => {
    const response = await fetch('/api/project-data', { cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 404 ? '项目数据文件不存在' : '项目数据文件读取失败');
    const value: unknown = await response.json();
    if (!isProjectData(value)) throw new Error('项目数据文件结构无效');
    if (value.dataRevision !== 16) throw new Error('项目数据版本不匹配');
    return normalizeProjectData(value);
  }, []);

  const persistToStore = useCallback(async (value: ProjectRelationshipData) => {
    const response = await fetch('/api/project-data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    if (!response.ok) throw new Error('本地数据文件保存失败');
  }, []);

  useEffect(() => { (async () => { try { setData(await loadStoredFile()); } catch { setLoadError('无法读取 store/project-relationship-data.json'); message.error('数据载入失败'); } })(); }, [loadStoredFile, message]);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; addEventListener('beforeunload', handler); return () => removeEventListener('beforeunload', handler); }, [dirty]);

  const elements = useMemo(() => data ? graphElements(data, selectedId, filter) : { nodes: [], edges: [] }, [data, selectedId, filter]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<GraphNodeData>>(elements.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(elements.edges);
  useEffect(() => { setNodes(layout(elements.nodes, elements.edges, data?.settings.layoutDirection ?? 'LR')); setEdges(elements.edges); }, [elements, setEdges, setNodes]);
  useEffect(() => { const timer = window.setTimeout(() => flowRef.current?.fitView({ padding: .12, duration: 350 }), 260); return () => window.clearTimeout(timer); }, [leftPanelVisible, rightPanelVisible]);
  useEffect(() => { if (window.matchMedia('(max-width: 900px)').matches) setRightPanelVisible(false); }, []);

  const writeToStore = useCallback(async (value: ProjectRelationshipData, showSuccess = false) => { const revision = ++storeRevisionRef.current; setDirty(true); try { await persistToStore(value); if (revision === storeRevisionRef.current) setDirty(false); if (showSuccess) message.success('配置已保存'); return true; } catch { if (revision === storeRevisionRef.current) setDirty(true); message.error({ key: 'store-write-error', content: '配置保存失败' }); return false; } }, [message, persistToStore]);
  const update = useCallback((next: ProjectRelationshipData) => { if (data) setHistory(items => [...items.slice(-24), structuredClone(data)]); setFuture([]); setData(next); setDirty(true); }, [data]);
  const save = useCallback(async () => { if (!data) return; const positions = Object.fromEntries(nodes.map(node => [node.id, node.position])); const next = { ...data, settings: { ...data.settings, positions } }; setData(next); await writeToStore(next, true); }, [data, nodes, writeToStore]);
  const undo = useCallback(() => { if (!data || !history.length) return; const previous = history.at(-1)!; setHistory(h => h.slice(0, -1)); setFuture(f => [structuredClone(data), ...f]); setData(previous); setDirty(true); }, [data, history]);
  const redo = useCallback(() => { if (!data || !future.length) return; const next = future[0]; setFuture(f => f.slice(1)); setHistory(h => [...h, structuredClone(data)]); setData(next); setDirty(true); }, [data, future]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); } }; addEventListener('keydown', key); return () => removeEventListener('keydown', key); }, [redo, save, undo]);

  const performLayout = () => { const placed = layout(nodes, edges, data?.settings.layoutDirection ?? 'LR'); setNodes(placed); setDirty(true); requestAnimationFrame(() => flowRef.current?.fitView({ padding: .14, duration: 500 })); };
  const toggleLeftPanel = () => setLeftPanelVisible(visible => { const next = !visible; if (next && window.matchMedia('(max-width: 900px)').matches) setRightPanelVisible(false); return next; });
  const toggleRightPanel = () => setRightPanelVisible(visible => { const next = !visible; if (next && window.matchMedia('(max-width: 900px)').matches) setLeftPanelVisible(false); return next; });
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

  const exportJson = () => { if (!data) return; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `项目部关系配置-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.json`; link.click(); URL.revokeObjectURL(link.href); };
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
  const importJson = async (file: File) => { try { const value: unknown = JSON.parse(await file.text()); if (!isProjectData(value)) throw new Error(); update(value); setSelectedId(null); message.success('导入成功，关系图已更新'); } catch { message.error('导入失败：请选择有效的配置文件'); } };
  const reloadStoredData = () => modal.confirm({ title: '重新加载已保存数据？', content: '尚未保存的页面修改将丢失。', okText: '重新加载', cancelText: '取消', onOk: async () => { const value = await loadStoredFile(); setData(value); setDirty(false); setHistory([]); setFuture([]); setSelectedId(null); setSelectedRelation(null); message.success('已重新加载保存数据'); } });

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
    if (editor.type === 'project') {
      update({ ...data, project: { ...data.project, ...values, id: data.project.id } });
      setEditor(null);
      message.success('已更新，等待保存');
      return;
    }
    const { parentProductId, ...entityValues } = values;
    const key = collectionByType[editor.type];
    const list = data[key] as unknown as Entity[];
    const item = { ...(editor.item ?? {}), ...entityValues, id: editor.item?.id ?? id(editor.type), icon: entityValues.icon ?? 'AppstoreOutlined' } as Entity;
    if (editor.type === 'device') delete (item as Entity & { icon?: string }).icon;
    const deviceType = editor.type === 'device' ? data.deviceTypes.find(type => type.id === entityValues.deviceTypeId) : undefined;
    if (editor.type === 'device' && deviceType?.category !== 'fixed') (item as { areaId?: string }).areaId = undefined;
    const nextList = editor.item ? list.map(old => old.id === item.id ? item : old) : [...list, item];
    let next = { ...data, [key]: nextList } as ProjectRelationshipData;
    if (editor.type === 'position') {
      const containment: Relation = { id: data.relations.find(rel => rel.sourceId === data.project.id && rel.targetId === item.id && rel.relationType === 'contains')?.id ?? id('position'), sourceType: 'project', sourceId: data.project.id, targetType: 'position', targetId: item.id, relationType: 'contains', label: '设置岗位' };
      next = { ...next, relations: [...data.relations.filter(rel => !(rel.targetId === item.id && rel.relationType === 'contains')), containment] };
    }
    if (editor.type === 'device') {
      const previous = data.relations.find(rel => rel.sourceId === item.id && rel.relationType === 'installed_in');
      const installation: Relation[] = deviceType?.category === 'fixed' && entityValues.areaId ? [{ id: previous?.id ?? id('installation'), sourceType: 'device', sourceId: item.id, targetType: 'area', targetId: entityValues.areaId, relationType: 'installed_in', label: '安装于' }] : [];
      next = { ...next, relations: [...next.relations.filter(rel => !(rel.sourceId === item.id && rel.relationType === 'installed_in')), ...installation] };
    }
    if (editor.type === 'person') {
      const positionIds = entityValues.positionIds as string[];
      const assignments: Relation[] = positionIds.map(positionId => ({ id: data.relations.find(rel => rel.sourceId === item.id && rel.targetId === positionId && rel.relationType === 'holds_position')?.id ?? id('assignment'), sourceType: 'person', sourceId: item.id, targetType: 'position', targetId: positionId, relationType: 'holds_position', label: '担任' }));
      next = { ...next, relations: [...next.relations.filter(rel => !(rel.sourceId === item.id && rel.relationType === 'holds_position')), ...assignments] };
    }
    if (editor.type === 'product') {
      const previous = data.relations.find(rel => rel.sourceType === 'product' && rel.targetType === 'product' && rel.targetId === item.id && rel.relationType === 'contains');
      const hierarchy: Relation[] = parentProductId && parentProductId !== item.id ? [{ id: previous?.id ?? id('product-parent'), sourceType: 'product', sourceId: parentProductId, targetType: 'product', targetId: item.id, relationType: 'contains', label: '集成子系统' }] : [];
      next = { ...next, relations: [...next.relations.filter(rel => !(rel.sourceType === 'product' && rel.targetType === 'product' && rel.targetId === item.id && rel.relationType === 'contains')), ...hierarchy] };
    }
    update(next);
    setEditor(null);
    message.success(editor.item ? '已更新，等待保存' : '已新增，等待保存');
  };
  const deleteEntity = (type: EntityType, entityId: string) => { if (!data || type === 'project') return; if (type === 'position') { const assigned = data.persons.filter(person => person.positionIds.includes(entityId)); if (assigned.length) { message.warning(`该岗位下还有 ${assigned.length} 名人员，请先调整人员岗位`); return; } } const relatedCount = data.relations.filter(rel => rel.sourceId === entityId || rel.targetId === entityId).length; modal.confirm({ title: `删除${entityLabels[type]}？`, content: relatedCount ? `该对象关联 ${relatedCount} 条关系，确认后将一并删除。` : '此操作无法撤销。', okText: '删除', okButtonProps: { danger: true }, onOk: () => { const key = collectionByType[type]; const list = data[key] as unknown as Entity[]; const next = { ...data, [key]: list.filter(item => item.id !== entityId), relations: data.relations.filter(rel => rel.sourceId !== entityId && rel.targetId !== entityId) } as ProjectRelationshipData; update(next); setSelectedId(null); message.success('已删除对象及关联关系，等待保存'); } }); };

  const recommendRelation = (sourceId?: string, targetId?: string): RelationType => { const source = sourceId ? entityIndex.get(sourceId)?.type : undefined; const target = targetId ? entityIndex.get(targetId)?.type : undefined; if ((source === 'position' || source === 'person') && (target === 'product' || target === 'device')) return 'uses'; if (source === 'person' && target === 'position') return 'holds_position'; if (source === 'product' && target === 'deviceType') return 'depends_on'; if (source === 'device' && target === 'product') return 'supports'; if (source === 'device' && target === 'area') return 'installed_in'; if (source === 'device') return 'binds_to'; return 'contains'; };
  const openRelationEditor = (relation?: Partial<Relation>) => { setRelationEditor(relation ?? { sourceType: 'position', targetType: 'product', relationType: 'uses' }); };
  const saveRelation = async () => { if (!data) return; const values = await relationForm.validateFields(); const source = entityIndex.get(values.sourceId); const target = entityIndex.get(values.targetId); if (!source || !target) return message.error('请选择有效的源对象和目标对象'); if (source.type === 'person' || target.type === 'person') { const otherType = source.type === 'person' ? target.type : source.type; if (otherType !== 'position' && otherType !== 'device') return message.error('人员只能关联岗位或设备，不能直接关联区域'); } if ((source.type === 'device' && target.type === 'area') || (source.type === 'area' && target.type === 'device')) { const device = source.type === 'device' ? source.entity : target.entity; const deviceType = 'deviceTypeId' in device ? data.deviceTypes.find(type => type.id === device.deviceTypeId) : undefined; if (deviceType?.category !== 'fixed') return message.error('只有固定设备可以安装到区域'); } const relation: Relation = { ...values, id: relationEditor?.id ?? id('relation'), sourceType: source.type, targetType: target.type, label: values.label || relationLabels[values.relationType as RelationType] };
    const relations = relationEditor?.id ? data.relations.map(old => old.id === relation.id ? relation : old) : [...data.relations, relation]; update({ ...data, relations }); setRelationEditor(null); message.success('关系已更新，等待保存'); };
  const deleteRelation = (relationId: string) => { if (!data) return; update({ ...data, relations: data.relations.filter(rel => rel.id !== relationId) }); setSelectedRelation(null); message.success('关系已删除，等待保存'); };
  const reorderEntityRelations = (entityId: string, draggedId: string, targetId: string) => { if (!data || draggedId === targetId) return; const related = data.relations.filter(rel => rel.sourceId === entityId || rel.targetId === entityId); const fromIndex = related.findIndex(rel => rel.id === draggedId); const targetIndex = related.findIndex(rel => rel.id === targetId); if (fromIndex < 0 || targetIndex < 0) return; const reordered = [...related]; const [dragged] = reordered.splice(fromIndex, 1); reordered.splice(targetIndex, 0, dragged); const relatedIds = new Set(related.map(rel => rel.id)); let cursor = 0; const relations = data.relations.map(rel => relatedIds.has(rel.id) ? reordered[cursor++] : rel); update({ ...data, relations }); message.success('关系顺序已调整，等待保存'); };
  const onConnect = (connection: Connection) => { if (!editMode || !connection.source || !connection.target) return; const source = entityIndex.get(connection.source); const target = entityIndex.get(connection.target); const relationType = recommendRelation(connection.source, connection.target); openRelationEditor({ sourceId: connection.source, targetId: connection.target, sourceType: source?.type, targetType: target?.type, relationType, label: relationLabels[relationType] }); };

  if (!data) return loadError ? <Result status="error" title="数据载入失败" subTitle={loadError} extra={<Button type="primary" onClick={() => location.reload()}>重新加载</Button>} /> : <div className="loading"><Spin size="large" /><Text>载入中</Text></div>;
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
        <Dropdown menu={{ items: [{ key: 'import', label: '导入配置', icon: <ImportOutlined /> }, { key: 'export', label: '导出配置', icon: <ExportOutlined /> }, { key: 'reload', label: '重新加载已保存数据', icon: <ReloadOutlined /> }], onClick: ({ key }) => key === 'import' ? fileRef.current?.click() : key === 'export' ? exportJson() : reloadStoredData() }}><Button icon={<DownloadOutlined />}>数据</Button></Dropdown>
        <Button type={dirty ? 'primary' : 'default'} icon={<SaveOutlined />} onClick={save}>{dirty ? '保存（有修改）' : '保存'}</Button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importJson(file); event.target.value = ''; }} />
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
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onInit={instance => { flowRef.current = instance; setTimeout(() => instance.fitView({ padding: .1 }), 80); }} onNodeClick={(_, node) => { setSelectedId(node.id); setSelectedRelation(null); }} onNodeDoubleClick={(_, node) => { const item = entityIndex.get(node.id); if (item) openEditor(item.type, item.entity); }} onEdgeClick={(_, edge) => { setSelectedRelation(edge.id); setSelectedId(null); }} onConnect={onConnect} nodesConnectable nodesDraggable onPaneClick={() => { setSelectedId(null); setSelectedRelation(null); }} onNodeDragStop={(_, node) => { if (!data) return; const next = { ...data, settings: { ...data.settings, positions: { ...data.settings.positions, [node.id]: node.position } } }; update(next); }} minZoom={.08} maxZoom={2.4} fitView>
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
    <div className="relation-list">{relations.length ? relations.map(rel => { const otherId = rel.sourceId === entity.id ? rel.targetId : rel.sourceId; const other = index.get(otherId); const otherName = other?.entity.name ?? '未知对象'; const displayLabel = rel.relationType === 'installed_in' && rel.targetId === entity.id ? '安装设备' : rel.relationType === 'holds_position' && rel.targetId === entity.id ? '任职人员' : (rel.label ?? relationLabels[rel.relationType]); return <div key={rel.id} className={`relation-item ${draggingId === rel.id ? 'dragging' : ''} ${dragOverId === rel.id ? 'drag-over' : ''}`} draggable={editMode} onDragStart={event => { setDraggingId(rel.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', rel.id); }} onDragEnter={() => { if (draggingId && draggingId !== rel.id) setDragOverId(rel.id); }} onDragOver={event => { if (editMode) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={event => { event.preventDefault(); const draggedRelationId = event.dataTransfer.getData('text/plain') || draggingId; if (draggedRelationId && draggedRelationId !== rel.id) onReorderRelations(draggedRelationId, rel.id); setDraggingId(null); setDragOverId(null); }} onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}>
      {editMode && <span className="relation-drag-handle" title="拖拽调整顺序"><HolderOutlined /></span>}
      <button className="relation-main" onClick={() => onLocate(otherId)}><i style={{ background: relationColors[rel.relationType] }} /><span><small>{displayLabel}</small><strong>{otherName}</strong></span><ExportOutlined /></button>
      {editMode && <Popconfirm title="删除这条关系？" description={`${displayLabel}：${otherName}`} okText="删除关系" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => onDeleteRelation(rel.id)}><Button className="relation-delete" danger type="text" size="small" aria-label={`删除关系 ${otherName}`} title="删除关系" icon={<DeleteOutlined />} onClick={event => event.stopPropagation()} /></Popconfirm>}
    </div>; }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联" />}</div>
    {editMode && <div className="detail-actions"><Button type="primary" icon={<PlusOutlined />} onClick={onAddRelation}>新增关系</Button></div>}
  </div>;
}

function RelationDetails({ relation, index, editMode, onEdit, onDelete }: { data: ProjectRelationshipData; relation: Relation; index: Map<string, { type: EntityType; entity: Entity }>; editMode: boolean; onEdit: () => void; onDelete: () => void }) {
  const source = index.get(relation.sourceId); const target = index.get(relation.targetId);
  return <div className="detail-content"><div className="detail-icon" style={{ color: relationColors[relation.relationType] }}><ExportOutlined /></div><Tag color={relationColors[relation.relationType]}>关系</Tag><Title level={4}>{relation.label ?? relationLabels[relation.relationType]}</Title><div className="relation-route"><Card size="small"><Text>{source ? entityLabels[source.type] : ''}</Text><strong>{source?.entity.name}</strong></Card><span style={{ color: relationColors[relation.relationType] }}>→</span><Card size="small"><Text>{target ? entityLabels[target.type] : ''}</Text><strong>{target?.entity.name}</strong></Card></div><div className="detail-field"><span>关系类型</span><strong>{relationLabels[relation.relationType]}</strong></div>{editMode && <div className="detail-actions"><Button type="primary" icon={<EditOutlined />} onClick={onEdit}>编辑关系</Button><Button danger icon={<DeleteOutlined />} onClick={onDelete}>删除关系</Button></div>}</div>;
}

export default function Application() { return <ErrorBoundary><ReactFlowProvider><AppContent /></ReactFlowProvider></ErrorBoundary>; }
