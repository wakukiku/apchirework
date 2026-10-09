export const tagColors = {
  green: "Зелёный",
  peach: "Персиковый",
  blue: "Голубой",
  purple: "Сиреневый",
  rose: "Розовый",
  sand: "Песочный",
};
export function InterestTags({
  interests,
  colors = {},
}: {
  interests: string[];
  colors?: Record<string, string>;
}) {
  return (
    <div className="tag-row">
      {interests.map((t) => (
        <span
          key={t}
          data-color={
            Object.prototype.hasOwnProperty.call(tagColors, colors[t])
              ? colors[t]
              : "green"
          }
        >
          {t}
        </span>
      ))}
    </div>
  );
}
