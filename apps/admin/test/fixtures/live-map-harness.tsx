import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OperationsLiveMap } from '../../src/components/operations-live-map';

const technician = {
  id: 'test-technician', full_name: 'Test technician', technician_code: 'TEST-1',
  is_available: true, is_on_duty: false, latitude: 30.0444, longitude: 31.2357,
  location_updated_at: null,
};
const order = {
  id: 'test-order', order_number: 'TEST-ORDER', service_name: 'Test service',
  status: 'accepted', scheduled_at: null, technician_id: technician.id,
  latitude: 30.06, longitude: 31.24,
};

function Harness() {
  const [shown, setShown] = useState(true);
  const [extra, setExtra] = useState(false);
  return <>
    <button onClick={() => setShown(!shown)}>Toggle map</button>
    <button onClick={() => setExtra(!extra)}>Update data</button>
    {shown && <OperationsLiveMap technicians={[technician]} orders={extra ? [order, { ...order, id: 'second', latitude: 30.05 }] : [order]} />}
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
