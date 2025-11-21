import { ModalWrapper, showToasts, showErrorToasts, emitGlobalSocketEvent } from '@capital/common';
import { Form, Input, Button, Space } from 'antd';
import React, { useState } from 'react';
import { Translate } from '../translate';

interface CreateOpenAppProps {
  onSuccess?: () => void;
}

export const CreateOpenApp: React.FC<CreateOpenAppProps> = React.memo(
  (props) => {
    const [form] = Form.useForm();
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (values: any) => {
      try {
        setSubmitting(true);
        await emitGlobalSocketEvent('openapi.app.create', {
          ...values,
          appIcon: '',
        });

        showToasts(Translate.createApplicationSuccess, 'success');
        props.onSuccess?.();
      } catch (e) {
        showErrorToasts(e);
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <ModalWrapper title={Translate.createApplication}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
        >
          <Form.Item
            label={Translate.app.appName}
            name="appName"
            rules={[
              { required: true, message: Translate.appNameCannotBeEmpty },
              { max: 20, message: Translate.appNameTooLong },
            ]}
          >
            <Input placeholder={Translate.enterAppName} />
          </Form.Item>

          <Form.Item
            label={Translate.app.appDesc}
            name="appDesc"
            rules={[
              { required: true, message: Translate.appDescCannotBeEmpty },
            ]}
          >
            <Input.TextArea placeholder={Translate.enterAppDesc} rows={3} />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
              >
                {Translate.createApplication}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </ModalWrapper>
    );
  }
);
CreateOpenApp.displayName = 'CreateOpenApp';
