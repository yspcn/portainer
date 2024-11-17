import axios, { parseAxiosError } from '@/portainer/services/axios';

import { Motd } from './types';

export async function getMotd() {
  try {
    const { data } = await axios.get<Motd>('/motd');
    return data;
  } catch (err) {
    throw parseAxiosError(
      err as Error,
      '无法检索信息消息'
    );
  }
}