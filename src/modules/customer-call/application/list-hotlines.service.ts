import { OmicallClient, SearchHotlinesResult } from "../../../utils/omicallClient";

const omicallClient = new OmicallClient();

export interface ListHotlinesFilters {
  page?: number;
  size?: number;
  keyword?: string;
}

export async function listHotlines(filters: ListHotlinesFilters): Promise<SearchHotlinesResult> {
  return omicallClient.searchHotlines({
    page: filters.page ?? 1,
    size: filters.size ?? 50,
    keyword: filters.keyword
  });
}
