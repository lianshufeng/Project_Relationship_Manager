export type EntityType = 'project' | 'team' | 'position' | 'person' | 'product' | 'deviceType' | 'device' | 'area';
export type RelationType = 'contains' | 'belongs_to' | 'holds_position' | 'uses' | 'depends_on' | 'binds_to' | 'installed_in' | 'supports' | 'manages' | 'covers';

export interface Project { id: string; name: string; shortName?: string; address?: string; description?: string; icon: string }
export interface Team { id: string; projectId: string; parentId?: string; name: string; type: string; icon: string; color?: string; sort: number; description?: string }
export interface Position { id: string; projectId: string; teamId?: string; name: string; icon: string; color?: string; sort: number; description?: string }
export interface Person { id: string; name: string; phone?: string; avatar?: string; icon: string; positionIds: string[]; description?: string }
export interface ProductModule { id: string; name: string; icon: string; color?: string; description?: string; activityLevel: number; activityUpdatedAt?: string }
export interface DeviceType { id: string; name: string; category: string; icon: string; color?: string; description?: string }
export interface DeviceInstance { id: string; deviceTypeId: string; areaId?: string; name: string; code?: string; description?: string; activityLevel: number; activityUpdatedAt?: string }
export interface Area { id: string; projectId: string; name: string; icon: string; description?: string }
export interface Relation { id: string; sourceType: EntityType; sourceId: string; targetType: EntityType; targetId: string; relationType: RelationType; label?: string }
export interface FeedbackAttachment { id: string; fileName: string; mimeType: string; size: number; url: string }
export interface FeedbackRecord { id: string; kind: 'feedback' | 'handling'; content?: string; authorName?: string; status?: 'pending' | 'resolved'; revision: number; createdAt: string; updatedAt: string; attachments: FeedbackAttachment[]; handlingRecords?: FeedbackRecord[] }
export interface FeedbackPage { items: FeedbackRecord[]; total: number; page: number; pageSize: number }
export interface GraphSettings { layoutDirection: 'LR' | 'TB'; positions: Record<string, { x: number; y: number }>; zoom?: number; viewportX?: number; viewportY?: number }
export interface ProjectRelationshipData { schemaVersion: '1.0'; dataRevision: 17; project: Project; teams: Team[]; positions: Position[]; persons: Person[]; products: ProductModule[]; deviceTypes: DeviceType[]; devices: DeviceInstance[]; areas: Area[]; relations: Relation[]; feedbackSummaries: Record<string, { total: number; unanswered: number }>; settings: GraphSettings }

export type Entity = Project | Team | Position | Person | ProductModule | DeviceType | DeviceInstance | Area;
export const collectionByType: Record<Exclude<EntityType, 'project'>, keyof ProjectRelationshipData> = { team: 'teams', position: 'positions', person: 'persons', product: 'products', deviceType: 'deviceTypes', device: 'devices', area: 'areas' };
