import axios, { AxiosInstance } from "axios";

export interface SearchCallTransactionsFilter {
  fromDate: number;
  toDate: number;
  directions?: string[];
  sipUsers?: string[];
  phoneNumbers?: string[];
  transactionIds?: string[];
  agentIds?: string[];
  isAnswer?: boolean;
}

export interface SearchCallTransactionsParams {
  page: number;
  size: number;
  filter: SearchCallTransactionsFilter;
  sort?: { field: string; isAsc: boolean };
}

export interface CallTransactionItem {
  transaction_id: string;
  direction: string;
  source_number: string;
  destination_number: string;
  sip_number: string;
  phone_number: string;
  disposition: string;
  bill_sec: number;
  answer_sec: number;
  duration: number;
  time_start_call: number;
  time_answer_start: number | null;
  time_end_call: number | null;
  time_ringing_start: number | null;
  recording_file_url: string;
  sip_user: string;
  hangup_cause: string;
  tag: string[];
}

export interface SearchCallTransactionsResult {
  items: CallTransactionItem[];
  page_number: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface CallTransactionDetail extends CallTransactionItem {
  call_out_price: number;
  record_seconds: number;
  note: string;
}

export interface UpdateCallTransactionInput {
  note?: string;
  tag?: string;
}

export type ExtensionDetailLookupType = "usr_uuid" | "sip_user" | "user_email";

export interface OmicallExtensionDetail {
  extension: string;
  full_name: string;
  mail: string;
  uuid: string;
  pbx_account: {
    display_name: string;
    sip_user: string;
    sip_password: string;
    sip_web_socket_server: string;
    sip_realm: string;
    sip_proxy: string;
    sip_proxy_port: string;
    stun_servers: string[];
    transport: string[];
    use_opus: boolean;
    opus_quality: number;
  };
}

export interface InviteAgentInput {
  identifyInfo: string;
  fullName: string;
  roleName: string;
  password: string;
  ownerEmail?: string;
}

export interface TransferAgentInput {
  sourceEmail: string;
  targetEmail: string;
  targetInfo?: { fullName?: string; phoneNumber?: string };
  callbackResultConfig?: { url: string; headers?: Record<string, string> };
}

export interface UpdateInternalPhoneInput {
  sipUser: string;
  password?: string;
  callTimeout?: string;
}

export interface HotlineWorkingDayTimeFrame {
  from?: string;
  to?: string;
  script?: string;
}

export interface HotlineWorkingDay {
  weekday: number;
  type: string;
  script?: string;
  time_frames?: HotlineWorkingDayTimeFrame[];
}

export interface HotlineConfigs {
  allow_call_in: boolean;
  allow_call_out: boolean;
  default_script: string | null;
  working_days: HotlineWorkingDay[];
  special_days: unknown[];
  call_configs: unknown;
  access_type: string;
  number_type: string;
  disable_by_time_frame: boolean;
  outbound_config: unknown;
}

export interface HotlineAccessEntry {
  id: string;
  type: string;
  name: string;
}

export interface HotlineItem {
  number: string;
  status: string;
  expire_date: number | null;
  created_date: number;
  last_updated_date: number;
  configs: HotlineConfigs;
  accesses: HotlineAccessEntry[];
}

export interface SearchHotlinesParams {
  page: number;
  size: number;
  keyword?: string;
}

export interface SearchHotlinesResult {
  items: HotlineItem[];
  page_number: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface UpdateHotlineConfigInput {
  hotline: string;
  extensions?: string[];
  group_ids?: string[];
  call_script?: string;
  allow_call_in?: string;
  allow_call_out?: string;
  access_type?: string;
}

export interface CallScriptItem {
  _id: string;
  extension?: string;
  script_name: string;
  script_name_unsigned?: string;
  note?: string;
  is_deleted?: boolean;
}

export interface ListCallScriptsResult {
  items: CallScriptItem[];
  page_number: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface InternalPhoneItem {
  sip_user: string;
  full_name: string;
  email?: string;
  agent_id?: string;
  public_number?: string;
}

export interface ListInternalPhonesParams {
  keyword?: string;
  page?: number;
  size?: number;
}

export interface ListInternalPhonesResult {
  items: InternalPhoneItem[];
  page_number: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

interface CachedOmicallToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedOmicallToken | null = null;
let pendingTokenRequest: Promise<string> | null = null;

function decodeJwtExpiry(accessToken: string): number | null {
  try {
    const payloadPart = accessToken.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payloadPart, "base64").toString("utf8"));
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function fetchOmicallAccessToken(): Promise<string> {
  const authClient = axios.create({
    baseURL: process.env.OMICALL_BASE_URL_V1,
    timeout: 10000
  });
  const { data } = await authClient.get("/api/auth", {
    params: { apiKey: process.env.OMICALL_API_KEY }
  });

  const accessToken = data?.payload?.access_token;
  if (!accessToken) {
    throw new Error("Không lấy được access_token từ Omicall /api/auth");
  }

  const expiresAt = decodeJwtExpiry(accessToken) ?? Date.now() + 23 * 60 * 60 * 1000;
  cachedToken = { accessToken, expiresAt };
  return accessToken;
}

async function getOmicallAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }
  if (!pendingTokenRequest) {
    pendingTokenRequest = fetchOmicallAccessToken().finally(() => {
      pendingTokenRequest = null;
    });
  }
  return pendingTokenRequest;
}

function createClient(baseURL: string | undefined): AxiosInstance {
  const instance = axios.create({ baseURL, timeout: 10000 });

  instance.interceptors.request.use(async (config) => {
    const token = await getOmicallAccessToken();
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      if (error.response?.status === 401 && originalRequest && !originalRequest._omicallRetried) {
        originalRequest._omicallRetried = true;
        const token = await getOmicallAccessToken(true);
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return instance(originalRequest);
      }
      return Promise.reject(error);
    }
  );

  return instance;
}

export class OmicallClient {
  private readonly v1: AxiosInstance;

  private readonly v2: AxiosInstance;

  private readonly v3: AxiosInstance;

  constructor() {
    this.v1 = createClient(process.env.OMICALL_BASE_URL_V1);
    this.v2 = createClient(process.env.OMICALL_BASE_URL_V2);
    this.v3 = createClient(process.env.OMICALL_BASE_URL_V3);
  }

  async searchCallTransactions({
    page,
    size,
    filter,
    sort
  }: SearchCallTransactionsParams): Promise<SearchCallTransactionsResult> {
    const { data } = await this.v3.post(
      "/api/v3/call-transaction/search",
      { filter, sort },
      { params: { page, size } }
    );
    return data.payload;
  }

  async getCallTransactionById(transactionId: string): Promise<CallTransactionDetail | null> {
    const { data } = await this.v2.get("/api/v2/callTransaction/getByTransactionId", {
      params: { transactionId }
    });
    return data?.payload ?? null;
  }

  async updateCallTransaction(
    transactionId: string,
    input: UpdateCallTransactionInput
  ): Promise<Record<string, unknown>> {
    const { data } = await this.v1.patch(`/api/call_transaction/change/${transactionId}`, input);
    return data;
  }

  async getAgentByEmail(email: string): Promise<Record<string, unknown>> {
    const { data } = await this.v2.get("/api/v2/agent/get-by-email", { params: { email } });
    return data;
  }

  async getExtensionDetail(
    type: ExtensionDetailLookupType,
    keyword: string
  ): Promise<OmicallExtensionDetail | null> {
    const { data } = await this.v1.get("/api/call_center/extensions/detail", {
      params: { type, keyword }
    });
    return data?.payload ?? null;
  }

  async inviteAgent(input: InviteAgentInput): Promise<Record<string, unknown>> {
    const { data } = await this.v1.post("/api/agent/invite", {
      identify_info: input.identifyInfo,
      full_name: input.fullName,
      role_name: input.roleName,
      password: input.password,
      ...(input.ownerEmail ? { owner_email: input.ownerEmail } : {})
    });
    return data?.payload ?? data;
  }

  async transferAgent(input: TransferAgentInput): Promise<{ requestId: string }> {
    const { data } = await this.v3.post("/api/v3/agent/transfer", {
      sourceEmail: input.sourceEmail,
      targetEmail: input.targetEmail,
      ...(input.targetInfo ? { targetInfo: input.targetInfo } : {}),
      ...(input.callbackResultConfig ? { callbackResultConfig: input.callbackResultConfig } : {})
    });
    return data?.payload;
  }

  async deleteAgent(email: string): Promise<Record<string, unknown>> {
    const { data } = await this.v1.get("/api/agent/delete", {
      params: { identify_info: email }
    });
    return data;
  }

  async updateInternalPhone(input: UpdateInternalPhoneInput): Promise<Record<string, unknown>> {
    const { data } = await this.v1.post("/api/call_center/internal_phone/update", {
      sip_user: input.sipUser,
      ...(input.password ? { password: input.password } : {}),
      ...(input.callTimeout ? { call_timeout: input.callTimeout } : {})
    });
    return data;
  }

  async searchHotlines(params: SearchHotlinesParams): Promise<SearchHotlinesResult> {
    const { data } = await this.v1.get("/api/call_center/hotline/search", {
      params: { page: params.page, size: params.size, keyword: params.keyword }
    });
    return data?.payload;
  }

  async getHotlineByPhone(hotline: string): Promise<HotlineItem | null> {
    const { data } = await this.v1.get("/api/call_center/hotline/by-phone", {
      params: { hotline }
    });
    return data?.payload ?? null;
  }

  async updateHotlineConfig(input: UpdateHotlineConfigInput): Promise<boolean> {
    const { data } = await this.v1.put("/api/call_center/hotline/update", input);
    return Boolean(data?.payload);
  }

  async listCallScripts(params: { page: number; size: number }): Promise<ListCallScriptsResult> {
    const { data } = await this.v1.get("/api/call_center/call_script/list", { params });
    return data?.payload;
  }

  async listInternalPhones(params: ListInternalPhonesParams): Promise<ListInternalPhonesResult> {
    const { data } = await this.v1.get("/api/call_center/internal_phone/list", { params });
    return data?.payload;
  }
}
