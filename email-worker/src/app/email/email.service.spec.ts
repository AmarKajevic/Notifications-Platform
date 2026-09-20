const sendMailMock = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
}));

import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(() => {
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue(undefined);
    service = new EmailService();
  });

  it('sends an email using the subject/body from the payload', async () => {
    await service.sendEmail('user@example.com', {
      subject: 'Welcome',
      body: 'Hello there',
    });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Welcome',
        text: 'Hello there',
      }),
    );
  });

  it('falls back to a default subject and a stringified payload when they are missing', async () => {
    await service.sendEmail('user@example.com', { foo: 'bar' });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Notification',
        text: JSON.stringify({ foo: 'bar' }),
      }),
    );
  });
});
