/**
 * IM (instant messaging) preload surface, split from `../electron.d.ts`.
 *
 * Method signatures derive from the zod IPC contracts
 * (`src/shared/ipc/imContract.ts`). The contracts keep the gateway config and
 * status projections opaque (`z.unknown()`) because results are not
 * runtime-validated, so those results are narrowed here to the domain types in
 * `../im`; per-instance config setters accept partial patches typed by the
 * same domain types. Push subscriptions stay hand-typed.
 */
import type { WeixinLoginErrorCode } from '../../../shared/ipc/channels';
import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { imContract, imInstanceContract } from '../../../shared/ipc/imContract';
import type {
  DiscordInstanceConfig,
  DingTalkInstanceConfig,
  FeishuInstanceConfig,
  IMConnectivityTestResult,
  IMGatewayConfig,
  IMGatewayConfigPatch,
  IMGatewayStatus,
  IMMessage,
  QQInstanceConfig,
  TelegramInstanceConfig,
  WecomInstanceConfig,
} from '../im';

type GatewayApi = IpcContractApi<typeof imContract>;
type InstanceApi = IpcContractApi<typeof imInstanceContract>;

type SuccessResult = { success: boolean; error?: string };

export interface ImApi
  extends
    Omit<
      GatewayApi,
      | 'getConfig'
      | 'setConfig'
      | 'testGateway'
      | 'getStatus'
      | 'weixinLoginStart'
      | 'weixinLoginPoll'
    >,
    Omit<InstanceApi, InstanceSetConfigKeys> {
  getConfig: () => Promise<{ success: boolean; config?: IMGatewayConfig; error?: string }>;
  setConfig: (
    config: IMGatewayConfigPatch,
    options?: { syncGateway?: boolean },
  ) => Promise<SuccessResult>;
  testGateway: (
    ...args: Parameters<GatewayApi['testGateway']>
  ) => Promise<{ success: boolean; result?: IMConnectivityTestResult; error?: string }>;
  getStatus: () => Promise<{ success: boolean; status?: IMGatewayStatus; error?: string }>;
  weixinLoginStart: () => Promise<{
    success: boolean;
    status?: 'wait';
    qrcode?: string;
    qrcodeUrl?: string;
    errorCode?: WeixinLoginErrorCode;
  }>;
  weixinLoginPoll: (qrcode: string) => Promise<{
    success: boolean;
    status: 'wait' | 'scaned' | 'confirmed' | 'expired';
    accountId?: string;
    errorCode?: WeixinLoginErrorCode;
  }>;
  setQQInstanceConfig: (
    instanceId: string,
    config: Partial<QQInstanceConfig>,
    options?: { syncGateway?: boolean },
  ) => Promise<SuccessResult>;
  setFeishuInstanceConfig: (
    instanceId: string,
    config: Partial<FeishuInstanceConfig>,
    options?: { syncGateway?: boolean },
  ) => Promise<SuccessResult>;
  setDingTalkInstanceConfig: (
    instanceId: string,
    config: Partial<DingTalkInstanceConfig>,
    options?: { syncGateway?: boolean },
  ) => Promise<SuccessResult>;
  setWecomInstanceConfig: (
    instanceId: string,
    config: Partial<WecomInstanceConfig>,
    options?: { syncGateway?: boolean },
  ) => Promise<SuccessResult>;
  setTelegramInstanceConfig: (
    instanceId: string,
    config: Partial<TelegramInstanceConfig>,
    options?: { syncGateway?: boolean },
  ) => Promise<SuccessResult>;
  setDiscordInstanceConfig: (
    instanceId: string,
    config: Partial<DiscordInstanceConfig>,
    options?: { syncGateway?: boolean },
  ) => Promise<SuccessResult>;
  onStatusChange: (callback: (status: IMGatewayStatus) => void) => () => void;
  onMessageReceived: (callback: (message: IMMessage) => void) => () => void;
}

type InstanceSetConfigKeys =
  | 'setQQInstanceConfig'
  | 'setFeishuInstanceConfig'
  | 'setDingTalkInstanceConfig'
  | 'setWecomInstanceConfig'
  | 'setTelegramInstanceConfig'
  | 'setDiscordInstanceConfig';
