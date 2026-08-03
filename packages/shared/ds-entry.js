// Design-system entry for design-sync. Hand-written on purpose: the package
// ships no build, and the converter's synth entry re-exports all 82 source
// files — pages, hooks and data-coupled screens included. This is the scoped
// surface: composable primitives plus the presentational components that carry
// the product's visual language.
export * from "./src/components/ui/accordion.jsx";
export * from "./src/components/ui/alert.jsx";
export * from "./src/components/ui/alert-dialog.jsx";
export * from "./src/components/ui/badge.jsx";
export * from "./src/components/ui/button.jsx";
export * from "./src/components/ui/card.jsx";
export * from "./src/components/ui/chart.jsx";
export * from "./src/components/ui/checkbox.jsx";
export * from "./src/components/ui/dialog.jsx";
export * from "./src/components/ui/dropdown-menu.jsx";
export * from "./src/components/ui/input.jsx";
export * from "./src/components/ui/label.jsx";
export * from "./src/components/ui/progress.jsx";
export * from "./src/components/ui/scroll-area.jsx";
export * from "./src/components/ui/select.jsx";
export * from "./src/components/ui/separator.jsx";
export * from "./src/components/ui/skeleton.jsx";
export * from "./src/components/ui/slider.jsx";
export * from "./src/components/ui/switch.jsx";
export * from "./src/components/ui/table.jsx";
export * from "./src/components/ui/tabs.jsx";
export * from "./src/components/ui/tooltip.jsx";

export * from "./src/components/AbbreviationTooltip.jsx";
export * from "./src/components/ApiWarnings.jsx";
export * from "./src/components/BaseModal.jsx";
export * from "./src/components/DeleteConfirmModal.jsx";
export * from "./src/components/ExcludeInvestmentDialog.jsx";
export * from "./src/components/LayeredGroupIcon.jsx";
export * from "./src/components/LoadingSkeletons.jsx";
export * from "./src/components/MetricPair.jsx";
export * from "./src/components/PriceSourceBadge.jsx";
export * from "./src/components/StatsCards.jsx";
export * from "./src/components/ThemeToggle.jsx";
