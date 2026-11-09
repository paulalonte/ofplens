import { formatWeight, type FlightPlanSummary, type WeightUnit } from '@ofplens/ofp';
import { Card, Row } from '../../components/Card';

interface Props {
  plan: FlightPlanSummary;
  displayUnit: WeightUnit;
}

export function FuelCard({ plan, displayUnit }: Props) {
  const { fuel, units } = plan;
  const w = (value: number) => formatWeight(value, units, displayUnit);

  return (
    <Card title="Fuel">
      <dl>
        <Row label="Trip">{w(fuel.trip)}</Row>
        <Row label="Contingency">{w(fuel.contingency)}</Row>
        <Row label={plan.alternate ? `Alternate (${plan.alternate.icao})` : 'Alternate'}>
          {plan.alternate ? w(fuel.alternate) : '—'}
        </Row>
        <Row label="Final reserve">{w(fuel.finalReserve)}</Row>
        <Row label="Extra">{w(fuel.extra)}</Row>
        <Row label="Taxi">{w(fuel.taxi)}</Row>
        <Row label="Block fuel" strong>
          {w(fuel.ramp)}
        </Row>
        <Row label="Planned landing">{w(fuel.landing)}</Row>
      </dl>
    </Card>
  );
}
