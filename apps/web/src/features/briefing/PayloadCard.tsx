import { formatWeight, type FlightPlanSummary, type WeightUnit } from '@ofplens/ofp';
import { Card, Row } from '../../components/Card';

interface Props {
  plan: FlightPlanSummary;
  displayUnit: WeightUnit;
}

export function PayloadCard({ plan, displayUnit }: Props) {
  const { weights, units } = plan;
  const w = (value: number) => formatWeight(value, units, displayUnit);

  return (
    <Card title="Payload">
      <dl>
        <Row label="Passengers">{weights.paxCount}</Row>
        <Row label="Cargo">{w(weights.cargo)}</Row>
        <Row label="Payload" strong>
          {w(weights.payload)}
        </Row>
        <Row label="Zero fuel weight">{w(weights.zfw)}</Row>
        <Row label="Takeoff weight">{w(weights.tow)}</Row>
        <Row label="Landing weight">{w(weights.ldw)}</Row>
      </dl>
    </Card>
  );
}
