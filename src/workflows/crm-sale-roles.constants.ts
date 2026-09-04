export const CRM_SALE_ROLE_CODE = {
  SALE: "CRM_SALE",
  TEAM_LEAD: "CRM_SALE_TEAM_LEAD"
} as const;

export type CrmSaleRoleCode = (typeof CRM_SALE_ROLE_CODE)[keyof typeof CRM_SALE_ROLE_CODE];

export const CRM_SALE_ROLE_CODES: CrmSaleRoleCode[] = [
  CRM_SALE_ROLE_CODE.SALE,
  CRM_SALE_ROLE_CODE.TEAM_LEAD
];

export const OMICALL_ROLE_NAME_BY_CODE: Record<CrmSaleRoleCode, string> = {
  [CRM_SALE_ROLE_CODE.SALE]: "Sale",
  [CRM_SALE_ROLE_CODE.TEAM_LEAD]: "Trưởng nhóm sale"
};
