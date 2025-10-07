
// npm install soap

const soap = require('soap');
const moment = require('moment-timezone');

class TebraClient {
    constructor(wsdlUrl, credentials, wsdlOptions = {}) {
        this.wsdlUrl = wsdlUrl;
        this.credentials = credentials;
        this.wsdlOptions = wsdlOptions;
        this.client = null;
    }

    async init() {
        if (!this.client) {
            this.client = await soap.createClientAsync(this.wsdlUrl, this.wsdlOptions);

            this.client.on('request', xml => {
                console.log('=== SOAP Request ===\n', xml);
            });
        }
        return this.client;
    }

    _buildArgs(body = {}) {
        return {
            request: {
                RequestHeader: {
                    ClientVersion: 'v1',
                    CustomerKey: this.credentials.customerKey,
                    Password: this.credentials.password,
                    User: this.credentials.user,
                },
                ...body
            }
        };
    }

    async getPractices() {
        const client = await this.init();
        const args = this._buildArgs({
            Fields: {},
            Filter: {},
        });
        const [result] = await client.GetPracticesAsync(args);
        return result.GetPracticesResult.Practices.PracticeData || [];
    }

    async getServiceLocations(practiceName, practiceId) {
        await this.init();
        const args = this._buildArgs({
            Fields: {},
            Filter: {
                PracticeName: practiceName,
                PracticeID: practiceId
            },
        });
        const [result] = await this.client.GetServiceLocationsAsync(args);
        return result.GetServiceLocationsResult.ServiceLocations.ServiceLocationData || [];
    }

    async getProvider(practiceName) {
        await this.init();
        const args = this._buildArgs({
            Fields: {},
            Filter: {
                PracticeName: practiceName
            },
        });
        const [result] = await this.client.GetProvidersAsync(args);
        return result.GetProvidersResult.Providers.ProviderData || [];
    }

    async getAppointments(filter) {
        await this.init();

        const args = this._buildArgs({
            Fields: {},
            Filter: {
                PracticeName: filter.PracticeName,
                StartDate: filter.StartDate || null,
                EndDate: filter.EndDate || null,
            },
        });
        const [result] = await this.client.GetAppointmentsAsync(args);
        return result.GetAppointmentsResult.Appointments.AppointmentData || [];
    }

    async getAvailableSlots(filter) {
        const SLOT_MIN = 30;                            // duración de slot en minutos
        const BUSY_RATIO = 0.5;                           // umbral: descartar citas > 50% de la ventana
        const TZ_FROM = 'America/Los_Angeles';
        const TZ_TO = 'America/New_York';
        const FORMAT_IN = 'M/D/YYYY h:mm:ss A';
        const officeStartHours = 8;                // hora de apertura
        const officeEndHours = 17;                 // hora de cierre

        // 1) Parsear rango del filtro
        const rangeStart = moment.tz(filter.StartDate, TZ_TO);
        let rangeEnd = moment.tz(filter.EndDate, TZ_TO);
        if (!filter.EndDate.match(/\d{1,2}:\d{2}/)) {
            rangeEnd = rangeEnd.clone().endOf('day');
        }

        // 2) Ventana de negocio 08:00–17:00 NY
        const dayBase = rangeStart.clone().startOf('day');
        const windowStart = dayBase.clone().hour(officeStartHours).minute(0).second(0);
        const windowEnd = dayBase.clone().hour(officeEndHours).minute(0).second(0);

        // 3) Intersección rango + ventana
        const startEff = moment.max(rangeStart, windowStart);
        const endEff = moment.min(rangeEnd, windowEnd);
        if (endEff.isSameOrBefore(startEff)) return [];

        // 4) Helper para parsear ISO o tu formato legacy
        const parseNY = s => {
            return moment(s, FORMAT_IN, true).isValid()
                ? moment.tz(s, FORMAT_IN, TZ_FROM).tz(TZ_TO)
                : moment.parseZone(s).tz(TZ_TO);
        };

        // 5) Recortar citas a [startEff, endEff]
        const raw = await this.getAppointments(filter);
        const busy = raw
            .map(a => {
                const s = parseNY(a.StartDate);
                const e = parseNY(a.EndDate);
                return {
                    start: moment.max(s, startEff),
                    end: moment.min(e, endEff)
                };
            })
            .filter(iv => iv.end.isAfter(startEff) && iv.start.isBefore(endEff))
            .sort((a, b) => a.start.valueOf() - b.start.valueOf());

        // 6) Descartar citas anómalamente largas (> 50% de la ventana)
        const windowMinutes = endEff.diff(startEff, 'minutes');
        const busyFiltered = busy.filter(iv =>
            iv.end.diff(iv.start, 'minutes') <= windowMinutes * BUSY_RATIO
        );

        // 7) Fusionar solapamientos
        const merged = [];
        for (const { start, end } of busyFiltered) {
            if (!merged.length || start.isAfter(merged[merged.length - 1].end)) {
                merged.push({ start: start.clone(), end: end.clone() });
            } else {
                merged[merged.length - 1].end = moment.max(merged[merged.length - 1].end, end);
            }
        }

        // 8) Generar slots libres de SLOT_MIN minutos
        const slots = [];
        let cursor = startEff.clone();
        for (const iv of merged) {
            while (cursor.clone().add(SLOT_MIN, 'minutes').isSameOrBefore(iv.start)) {
                const next = cursor.clone().add(SLOT_MIN, 'minutes');
                slots.push({
                    start: cursor.format('YYYY-MM-DDTHH:mm:ssZ'),
                    end: next.format('YYYY-MM-DDTHH:mm:ssZ'),
                });
                cursor = next;
            }
            if (cursor.isBefore(iv.end)) cursor = iv.end.clone();
        }
        while (cursor.clone().add(SLOT_MIN, 'minutes').isSameOrBefore(endEff)) {
            const next = cursor.clone().add(SLOT_MIN, 'minutes');
            slots.push({
                start: cursor.format('YYYY-MM-DDTHH:mm:ssZ'),
                end: next.format('YYYY-MM-DDTHH:mm:ssZ'),
            });
            cursor = next;
        }

        return slots;
    }

    async getPatients({ practiceId, filters }) {
        await this.init();

        const args = this._buildArgs({
            Fields: {},
            Filter: {
                ...filters
            },
        });
        const [result] = await this.client.GetPatientsAsync(args);
        return result.GetPatientsResult.Patients.PatientData || [];
    }

    async findPatient({firstName, lastName, phone}) {
        const patients = await this.getPatients({
            filters: {
                FirstName: firstName,
                LastName: lastName,
                MobilePhone: phone
            }
        });

        return patients.length ? patients[0] : null;
    }

    async createPatient({ practiceId, firstName, lastName, email, phone, gender, birthDate }) {
        const client = await this.init();

        const args = this._buildArgs({
            Patient: {
                FirstName: firstName,
                LastName: lastName,
                EmailAddress: email,
                MobilePhone: phone,
                Practice: {
                    PracticeID: practiceId,
                },
                BirthDate: birthDate,
                Gender: gender,
            }
        });
        const [result] = await client.CreatePatientAsync(args);
        return result.CreatePatientResult;
    }

    async updatePatient({ practiceId, firstName, lastName, email, phone, gender, birthDate }) {
        const client = await this.init();

        const args = this._buildArgs({
            Patient: {
                Practice: {
                    PracticeID: practiceId,
                },
                PatientID: '1113',
                FirstName: firstName,
                LastName: lastName,
                BirthDate: birthDate,
                Gender: gender,
                MobilePhone: phone,
                EmailAddress: email,
            }
        });
        const [result] = await client.UpdatePatientAsync(args);
        return result.UpdatePatientResult;
    }

    async scheduleAppointment({ practiceId, serviceLocationId, providerId, start, end, PatientId }) {
        const client = await this.init();

        const args = this._buildArgs({
            Appointment: {
                AppointmentStatus: 'Scheduled',
                AppointmentType: 'P',
                EndTime: end,
                IsRecurring: false,
                PatientSummary: {
                    PatientId: PatientId,
                },
                PracticeId: practiceId,
                ProviderId: providerId,
                ServiceLocationId: serviceLocationId,
                StartTime: start
            }
        });
        const [result] = await client.CreateAppointmentAsync(args);
        return result;
    }
}

(async () => {
    

    const KAREO_WSDL = 'https://webservice.kareo.com/services/soap/2.1/KareoServices.svc?singleWsdl';

    const client = new TebraClient(
        KAREO_WSDL,
        {
            customerKey: 'c64xz78ip32n',
            user: 'yozamyd@gmail.com',
            password: 'Sfmg16969$$$'
        }
    );

    const patient = await client.findPatient({
        firstName: 'Manuel',
        lastName: 'Rodriguez',
        phone: '9043020155'
    });

    const practices = await client.getPractices();
    const { ID: practiceId, PracticeName: practiceName } = practices[0];

    const providers = await client.getProvider(practiceName);
    const { ID: providerId } = providers[5];

    const serviceLocations = await client.getServiceLocations(practiceName, practiceId);
    const { ID: serviceLocationId } = serviceLocations[0];

    const patients = await client.getPatients({
        practiceId, filters: {
            FirstName: 'Manuel',
            LastName: 'Rodriguez',
        }
    });

    console.table(patients, ['ID', 'FirstName', 'LastName', 'EmailAddress', 'MobilePhone']);

    await client.createPatient({
        firstName: 'Manuel',
        lastName: 'Rodriguez',
        email: 'rdgztorres19@gmail.com',
        phone: '9043020155',
        practiceId: practiceId,
        gender: 'Male',
        birthDate: '1990-04-19'
    });

    // 4) Obtener citas de hoy y calcular huecos (ejemplo)
    // const todayStart = moment().startOf('day').toISOString();
    // const todayEnd = moment().endOf('day').toISOString();
    // const slots = await client.getAvailableSlots({
    //     PracticeName: practiceName,
    //     StartDate: todayStart,
    //     EndDate: todayEnd
    // });
    // console.log('Huecos disponibles:', slots);

    try {
        const result = await client.scheduleAppointment({
            practiceId,
            serviceLocationId,
            providerId,
            start: '2025-05-17T06:00:00Z',
            end: '2025-05-17T06:30:00Z',
            PatientId: '1113',
        });

        console.log('Cita creada:', result);
    } catch (error) {
        console.error('Error al crear la cita:', error.message);
    }
})();