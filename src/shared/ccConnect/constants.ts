export const CcConnectProtocol = {
  Version: '1',
  ClockSkewMs: 5 * 60 * 1000,
  Header: {
    Version: 'x-zhiyuan-protocol-version',
    RequestId: 'x-zhiyuan-request-id',
    Timestamp: 'x-zhiyuan-timestamp-ms',
    Nonce: 'x-zhiyuan-nonce',
  },
  Capability: {
    ChannelTransport: 'channel-transport',
    Delivery: 'delivery',
    TriggerOnlyCron: 'trigger-only-cron',
  },
} as const;

export type CcConnectCapability =
  (typeof CcConnectProtocol.Capability)[keyof typeof CcConnectProtocol.Capability];

export type CcConnectHealth = {
  protocolVersion: string;
  pid: number;
  parentPid: number;
  capabilities: string[];
};
