import { RateQuote, Shipment } from '../types';

export interface CarrierAdapter {
  getRates(shipment: Shipment): Promise<RateQuote[]>;
}
