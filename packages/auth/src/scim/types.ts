export interface SCIMEmail {
  value: string;
  primary: boolean;
}

export interface SCIMUserRecord {
  id: string;
  tenantId: string;
  externalId: string | null;
  externalSource: string | null;
  userName: string;
  displayName: string;
  emails: SCIMEmail[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SCIMGroupMember {
  value: string;
  display?: string;
}

export interface SCIMGroupRecord {
  id: string;
  tenantId: string;
  displayName: string;
  externalId: string | null;
  externalSource: string | null;
  members: SCIMGroupMember[];
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type SCIMPatchOpType = 'add' | 'remove' | 'replace';

export interface SCIMPatchOp {
  op: SCIMPatchOpType;
  path: string;
  value?: unknown;
}

export interface SCIMPatchRequest {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'];
  Operations: SCIMPatchOp[];
}

export interface SCIMListResponse<T> {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface SCIMFilter {
  field: string;
  operator: 'eq' | 'ne' | 'co' | 'sw' | 'pr';
  value?: string;
}

export interface SCIMListParams {
  filter?: SCIMFilter;
  startIndex: number;
  count: number;
}

export interface SCIMUserStore {
  create(
    tenantId: string,
    record: Omit<SCIMUserRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<SCIMUserRecord>;
  getById(tenantId: string, id: string): Promise<SCIMUserRecord | null>;
  getByExternalId(tenantId: string, externalId: string): Promise<SCIMUserRecord | null>;
  getByUserName(tenantId: string, userName: string): Promise<SCIMUserRecord | null>;
  update(
    tenantId: string,
    id: string,
    patch: Partial<SCIMUserRecord>,
  ): Promise<SCIMUserRecord | null>;
  list(
    tenantId: string,
    params: SCIMListParams,
  ): Promise<{ records: SCIMUserRecord[]; total: number }>;
}

export interface SCIMGroupStore {
  create(
    tenantId: string,
    record: Omit<
      SCIMGroupRecord,
      'id' | 'tenantId' | 'members' | 'memberCount' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<SCIMGroupRecord>;
  getById(tenantId: string, id: string): Promise<SCIMGroupRecord | null>;
  getByExternalId(tenantId: string, externalId: string): Promise<SCIMGroupRecord | null>;
  update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<SCIMGroupRecord, 'displayName' | 'externalId' | 'externalSource'>>,
  ): Promise<SCIMGroupRecord | null>;
  delete(tenantId: string, id: string): Promise<void>;
  syncMembers(groupId: string, userIds: string[]): Promise<void>;
  addMember(groupId: string, userId: string): Promise<void>;
  removeMember(groupId: string, userId: string): Promise<void>;
  list(
    tenantId: string,
    params: SCIMListParams,
  ): Promise<{ records: SCIMGroupRecord[]; total: number }>;
}

export interface SCIMTokenStore {
  /** Look up a SCIM bearer token (by its SHA-256 hash) to get tenantId + directoryId */
  findByToken(
    hashedToken: string,
  ): Promise<{ tenantId: string; directoryId: string | null } | null>;
  /** Look up a WorkOS directory_id to resolve tenantId for webhook delivery */
  findByDirectoryId(directoryId: string): Promise<{ tenantId: string } | null>;
}
