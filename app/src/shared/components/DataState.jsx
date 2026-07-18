export const DATA_STATE_VARIANTS = Object.freeze([
  "loading",
  "error",
  "empty",
  "stale",
  "partial",
]);

export function DataState({ as: Component = "div", variant, className = "", children, ...props }) {
  const safeVariant = DATA_STATE_VARIANTS.includes(variant) ? variant : "empty";
  const role = Component === "div" ? (safeVariant === "error" ? "alert" : "status") : undefined;
  return (
    <Component className={className || undefined} role={role} data-state={safeVariant} {...props}>
      {children}
    </Component>
  );
}
