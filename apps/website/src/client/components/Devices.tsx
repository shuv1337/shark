import type { DeviceDto } from "@hark/contracts";
import { useState } from "react";
import { api } from "../lib/api";
import { useConfirm } from "./ConfirmDialog";
import {
  EmptyState,
  ErrorText,
  errorMessage,
  InlineCode,
  SECTION,
  SectionHeading,
  SkeletonList,
} from "./DashboardKit";
import { rowButton, rowDangerButton } from "./ui";

/** Every device registered to deliver notifications, and how to address one. */
export function DevicesSection({
  devices,
  onRemoved,
}: {
  devices: DeviceDto[] | null;
  onRemoved: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const remove = async (device: DeviceDto) => {
    const deviceLabel =
      device.deviceName ?? (device.platform === "web" ? "this browser" : "this iPhone");
    const confirmed = await confirm({
      title: "Remove device",
      message: `Remove ${deviceLabel} from SHark? It stops receiving notifications until it is registered again.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(device.id);
    setError(null);
    try {
      await api.removeDevice(device.id);
      onRemoved();
    } catch (err) {
      setError(errorMessage(err, "Could not remove this device"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="devices-heading" className={`${SECTION} scroll-mt-24`} id="devices">
      <SectionHeading
        id="devices-heading"
        title="Devices"
        description={
          <>
            Omit <InlineCode>deviceIds</InlineCode> to notify every active device. Include IDs to
            route a webhook to specific devices.
          </>
        }
      />
      {devices === null ? (
        <SkeletonList label="Loading devices" rowClassName="h-14" rows={2} />
      ) : null}
      {devices?.length === 0 ? (
        <EmptyState title="No devices registered">
          Sign in inside the SHark iPhone app, or enable notifications for this browser above.
          Without a device SHark accepts webhooks but has nowhere to deliver them.
        </EmptyState>
      ) : null}
      {devices && devices.length > 0 ? (
        <ul className="divide-y divide-line border-y border-line">
          {devices.map((device) => (
            <li className="flex items-center justify-between gap-4 py-3" key={device.id}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {device.deviceName ?? (device.platform === "web" ? "Browser" : "iPhone")}
                  {!device.active ? (
                    <span className="ml-2 text-xs text-ink-faint">Inactive</span>
                  ) : null}
                </p>
                <p className="truncate font-mono text-[11px] text-ink-faint">{device.id}</p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {device.platform === "web"
                    ? `Web Push · refreshed ${new Date(device.lastSeenAt).toLocaleString()}`
                    : device.liveActivitiesCapable
                      ? `Live Activities ready · ${device.liveActivityTokenEnvironment} · refreshed ${new Date(
                          device.liveActivityTokenUpdatedAt ?? device.lastSeenAt,
                        ).toLocaleString()}`
                      : "Live Activities token not registered"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  className={rowButton}
                  onClick={() => void navigator.clipboard.writeText(device.id)}
                  type="button"
                >
                  Copy ID
                </button>
                <button
                  className={rowDangerButton}
                  disabled={busyId === device.id}
                  onClick={() => void remove(device)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {dialog}
    </section>
  );
}
