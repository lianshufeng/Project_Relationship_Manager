import type { Entity, EntityType, ProjectRelationshipData, RelationType } from './types';

export const entityLabels: Record<EntityType, string> = { project: '项目部', team: '团队', position: '岗位', person: '人员', product: '系统', deviceType: '设备类型', device: '设备', area: '施工区域' };
export const relationLabels: Record<RelationType, string> = { contains: '包含', belongs_to: '属于', holds_position: '担任', uses: '使用', depends_on: '依赖', binds_to: '绑定', installed_in: '安装于', supports: '支撑功能', manages: '管理', covers: '覆盖' };
export const relationColors: Record<RelationType, string> = { contains: '#1677ff', belongs_to: '#1677ff', holds_position: '#13c2c2', uses: '#52c41a', depends_on: '#fa8c16', binds_to: '#9254de', installed_in: '#fadb14', supports: '#ff7a45', manages: '#ffc53d', covers: '#fadb14' };

export function id(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
export function entityName(entity: Entity) { return entity.name; }
export function isProjectData(value: unknown): value is ProjectRelationshipData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<ProjectRelationshipData>;
  return data.schemaVersion === '1.0' && !!data.project && ['teams', 'positions', 'persons', 'products', 'deviceTypes', 'devices', 'areas', 'relations'].every((key) => Array.isArray(data[key as keyof ProjectRelationshipData]));
}

export function normalizeProjectData(data: ProjectRelationshipData): ProjectRelationshipData {
  const withoutStatus = <T extends object>(value: T): T => { const { status: _status, ...rest } = value as T & { status?: unknown }; return rest as T; };
  const withoutEnabled = <T extends object>(value: T): T => { const { enabled: _enabled, ...rest } = value as T & { enabled?: unknown }; return rest as T; };
  const withoutLegacyDeviceFields = <T extends object>(value: T): T => { const { serialNumber: _serialNumber, bindType: _bindType, bindTargetId: _bindTargetId, icon: _icon, ...rest } = value as T & { serialNumber?: unknown; bindType?: unknown; bindTargetId?: unknown; icon?: unknown }; return rest as T; };
  const withoutRiskLevel = <T extends object>(value: T): T => { const { riskLevel: _riskLevel, ...rest } = value as T & { riskLevel?: unknown }; return rest as T; };
  const withoutProductCategory = <T extends object>(value: T): T => { const { category: _category, ...rest } = value as T & { category?: unknown }; return rest as T; };
  const withoutAreaType = <T extends object>(value: T): T => { const { type: _type, ...rest } = value as T & { type?: unknown }; return rest as T; };
  const idsByType: Record<EntityType, Set<string>> = {
    project: new Set([data.project.id]), team: new Set(data.teams.map(item => item.id)), position: new Set(data.positions.map(item => item.id)),
    person: new Set(data.persons.map(item => item.id)), product: new Set(data.products.map(item => item.id)), deviceType: new Set(data.deviceTypes.map(item => item.id)),
    device: new Set(data.devices.map(item => item.id)), area: new Set(data.areas.map(item => item.id)),
  };
  const fixedDeviceIds = new Set(data.devices.filter(device => data.deviceTypes.find(type => type.id === device.deviceTypeId)?.category === 'fixed').map(device => device.id));
  return {
    ...data,
    dataRevision: 16,
    project: withoutStatus(data.project),
    positions: data.positions.map(position => ({ ...position, projectId: data.project.id })),
    persons: data.persons.map(person => withoutStatus({ ...person, positionIds: person.positionIds.filter(positionId => idsByType.position.has(positionId)) })),
    products: data.products.map(product => withoutProductCategory(withoutStatus(product))),
    areas: data.areas.map(area => withoutAreaType(withoutRiskLevel(area))),
    devices: data.devices.map(device => {
      const normalized = withoutLegacyDeviceFields(withoutStatus(device));
      return normalized.areaId && !idsByType.area.has(normalized.areaId) ? { ...normalized, areaId: undefined } : normalized;
    }),
    relations: data.relations.map(withoutEnabled).filter(relation => {
      if (!idsByType[relation.sourceType].has(relation.sourceId) || !idsByType[relation.targetType].has(relation.targetId)) return false;
      if (relation.relationType === 'contains' && relation.targetType === 'position') return relation.sourceType === 'project' && relation.sourceId === data.project.id;
      if (data.dataRevision >= 4 && !['contains', 'holds_position'].includes(relation.relationType) && !relation.id.startsWith('rel-v')) return false;
      if (relation.sourceType === 'area' || relation.targetType === 'area') {
        if (relation.relationType === 'covers') return relation.sourceType === 'project' && relation.targetType === 'area';
        if (relation.relationType === 'installed_in') return relation.sourceType === 'device' && relation.targetType === 'area' && fixedDeviceIds.has(relation.sourceId);
        return false;
      }
      if (relation.sourceType !== 'person' && relation.targetType !== 'person') return true;
      const otherType = relation.sourceType === 'person' ? relation.targetType : relation.sourceType;
      return otherType === 'position' || otherType === 'device';
    }),
  };
}
