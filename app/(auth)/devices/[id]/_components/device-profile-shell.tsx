"use client";

import { useId, useState } from "react";
import Link from "next/link";

import {
  DeviceAuditTrailCard,
  DeviceEditForm,
  DeviceInfoCard,
  DeviceProfileHeader,
} from "@/components/composed";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useDevice, useDeviceRealtime } from "@/lib/queries/devices";

export type DeviceProfileShellProps = {
  deviceId: string;
  label: string;
};

export function DeviceProfileShell({ deviceId, label }: DeviceProfileShellProps) {
  const [editOpen, setEditOpen] = useState(false);
  const channelKey = useId();
  const { data: device } = useDevice(deviceId);

  // Central realtime subscription for this profile — invalidates detail +
  // audit slots so info card and audit trail card share one channel instead
  // of mounting one each.
  useDeviceRealtime(deviceId, channelKey);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/articles">Artikel</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          {device?.article_id ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={`/articles/${device.article_id}`}>
                    {device.articles
                      ? [
                          device.articles.article_number,
                          device.articles.name,
                          device.articles.variant_label,
                        ]
                          .filter(Boolean)
                          .join(" ")
                      : "Artikel"}
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </>
          ) : null}
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <DeviceProfileHeader
        deviceId={deviceId}
        onEdit={() => setEditOpen(true)}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <DeviceInfoCard deviceId={deviceId} onEdit={() => setEditOpen(true)} />
        </div>
        <div className="flex flex-col gap-6">
          <DeviceAuditTrailCard deviceId={deviceId} />
        </div>
      </div>

      {editOpen ? (
        <DeviceEditForm
          mode="edit"
          deviceId={deviceId}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      ) : null}
    </div>
  );
}
