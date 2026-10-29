import { HomeCard } from '../app/home-cards';
import { useNeeds } from '../app/needs';
import { NeedsSection } from './NeedsList';

/** Home's "Needs you": the same rows as Settings' section of that name; nothing shows while nothing waits. */
export function NeedsCard() {
  const needs = useNeeds();
  if (needs.length === 0) return null;
  return (
    <HomeCard id="needs" title="Needs you" wide>
      <NeedsSection needs={needs} />
    </HomeCard>
  );
}
