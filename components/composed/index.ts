export { PageShell, type PageShellProps } from "./page-shell";
export { PageHeader, type PageHeaderProps } from "./page-header";
export { CountBadge, type CountBadgeProps } from "./count-badge";
export { CustomerTable, type CustomerTableProps } from "./customer-table";
export { CustomerEditForm, type CustomerEditFormProps } from "./customer-edit-form";
export { CustomerAddressFields } from "./customer-address-fields";
export { AddressFormFields } from "./address-form-fields";
export {
  AddressTypeBadge,
  type AddressTypeBadgeProps,
} from "./address-type-badge";
export {
  AddressTypePicker,
  type AddressTypePickerProps,
} from "./address-type-picker";
export { AddressRow, type AddressRowProps } from "./address-row";
export {
  AddressDialog,
  type AddressDialogMode,
  type AddressDialogProps,
} from "./address-dialog";
export {
  CustomerAddressesCard,
  type CustomerAddressesCardProps,
} from "./customer-addresses-card";
export { RowActions, type RowActionsProps } from "./row-actions";
export {
  CustomerListFilters,
} from "./customer-list-filters";
export {
  TablePagination,
  type TablePaginationProps,
} from "./table-pagination";
export {
  InsuranceBadge,
  type InsuranceBadgeProps,
  type InsuranceBadgeInsurer,
} from "./insurance-badge";
export {
  BexioSyncBadge,
  type BexioSyncBadgeProps,
  type BexioSyncBadgeStatus,
} from "./bexio-sync-badge";
export { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";
export { ContactAvatar, type ContactAvatarProps } from "./contact-avatar";
export { ContactDialog, type ContactDialogProps } from "./contact-dialog";
export { ContactRoleBadge, type ContactRoleBadgeProps } from "./contact-role-badge";
export { ContactRolePicker, type ContactRolePickerProps } from "./contact-role-picker";
export { ContactRow, type ContactRowProps } from "./contact-row";
export {
  CustomerContactsCard,
  type CustomerContactsCardProps,
} from "./customer-contacts-card";
export {
  CustomerInsuranceCard,
  type CustomerInsuranceCardProps,
} from "./customer-insurance-card";
export {
  InsuranceDialog,
  type InsuranceDialogMode,
  type InsuranceDialogProps,
} from "./insurance-dialog";
export { InsuranceRow, type InsuranceRowProps } from "./insurance-row";
export {
  InsuranceTypeBadge,
  type InsuranceTypeBadgeProps,
} from "./insurance-type-badge";
export {
  BexioStatusBadge,
  type BexioConnectionState,
} from "./bexio-status-badge";
export {
  DefinitionRow,
  type DefinitionRowProps,
} from "./definition-row";
export {
  CustomerInfoCard,
  type CustomerInfoCardProps,
} from "./customer-info-card";
export {
  BexioContactCard,
  type BexioContactCardProps,
} from "./bexio-contact-card";
export {
  CustomerDevicesCard,
  type CustomerDevicesCardProps,
} from "./customer-devices-card";
export {
  CustomerOrdersCard,
  type CustomerOrdersCardProps,
} from "./customer-orders-card";
// Story 2.5.1 — MTG-008 add-ons (invoices table, revenue KPI, dual notes,
// documents stub). Each card is a layout-first stub except <CustomerNotesCard>,
// which wires the existing `customers.notes` column live.
export {
  CustomerInvoicesCard,
  type CustomerInvoicesCardProps,
} from "./customer-invoices-card";
export {
  CustomerRevenueCard,
  type CustomerRevenueCardProps,
} from "./customer-revenue-card";
export {
  CustomerNotesCard,
  type CustomerNotesCardProps,
} from "./customer-notes-card";
export {
  CustomerDocumentsCard,
  type CustomerDocumentsCardProps,
} from "./customer-documents-card";
export {
  CustomerProfileHeader,
  type CustomerProfileHeaderProps,
} from "./customer-profile-header";

// Story 3.1 — article domain.
export { StatusBadge, type StatusBadgeProps } from "./status-badge";
export { PriceDisplay, type PriceDisplayProps } from "./price-display";
export {
  ArticleListFilters,
  type ArticleListFiltersProps,
} from "./article-list-filters";
export { ArticleTable, type ArticleTableProps } from "./article-table";
export {
  ArticleProfileHeader,
  type ArticleProfileHeaderProps,
} from "./article-profile-header";
export {
  ArticleInfoCard,
  type ArticleInfoCardProps,
} from "./article-info-card";
export { PriceListCard, type PriceListCardProps } from "./price-list-card";
export {
  PriceListEditDialog,
  type PriceListEditDialogProps,
} from "./price-list-edit-dialog";
export {
  ArticleEditForm,
  type ArticleEditFormMode,
  type ArticleEditFormProps,
} from "./article-edit-form";

// Story 3.2 — device domain.
export {
  ArticleDevicesCard,
  type ArticleDevicesCardProps,
} from "./article-devices-card";
export {
  ArticlePurchaseStockCard,
  type ArticlePurchaseStockCardProps,
} from "./article-purchase-stock-card";
export {
  DeviceListFilters,
  type DeviceListFiltersProps,
} from "./device-list-filters";
export { DeviceTable, type DeviceTableProps } from "./device-table";
export {
  DeviceProfileHeader,
  type DeviceProfileHeaderProps,
} from "./device-profile-header";
export {
  DeviceInfoCard,
  type DeviceInfoCardProps,
} from "./device-info-card";
export {
  DeviceAuditTrailCard,
  type DeviceAuditTrailCardProps,
} from "./device-audit-trail-card";
export {
  DeviceEditForm,
  type DeviceEditFormProps,
} from "./device-edit-form";

// Inventory list components
export {
  InventoryFilters,
  parseInventoryFiltersFromSearchParams,
  type InventoryFiltersProps,
} from "./inventory-filters";
export {
  InventoryTable,
  type InventoryTableProps,
} from "./inventory-table";
