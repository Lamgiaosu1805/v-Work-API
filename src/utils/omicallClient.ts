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

function createClient(baseURL: string | undefined): AxiosInstance {
  return axios.create({
    baseURL,
    headers: { Authorization: `Bearer ${process.env.OMICALL_API_KEY}` },
    timeout: 10000
  });
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
}
