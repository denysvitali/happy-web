import classes from "./Skeleton.module.css";

/** Shimmering placeholder block. Size it with `w`/`h` (CSS lengths or numbers = px); `circle` for avatars. */
export function Skeleton({ w = "100%", h = 10, circle = false }: { w?: number | string; h?: number | string; circle?: boolean }) {
  return <span className={classes.block} data-circle={circle || undefined} style={{ width: w, height: h }} aria-hidden />;
}

/** Placeholder shaped like a session card; wrap a few in a grid while sessions load. */
export function CardSkeleton() {
  return (
    <div className={classes.card} aria-hidden>
      <div className={classes.head}>
        <Skeleton w={32} h={32} circle />
        <div className={classes.lines}>
          <Skeleton w="62%" h={11} />
          <Skeleton w="40%" h={9} />
        </div>
      </div>
      <Skeleton w="48%" h={9} />
    </div>
  );
}

/** Placeholder shaped like a StatCard. */
export function StatSkeleton() {
  return (
    <div className={classes.card} aria-hidden>
      <Skeleton w="44%" h={9} />
      <Skeleton w={36} h={22} />
    </div>
  );
}
