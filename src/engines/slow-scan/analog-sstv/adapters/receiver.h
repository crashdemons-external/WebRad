#pragma once
#include "web_compat.h"
#include "sstv.h"
#include "Fft.h"
#include <memory>

struct Bitmap {
    int Width = 320, Height = 256;
    std::vector<BYTE> data;
    struct Rows {
        Bitmap* owner;
        BYTE* operator[](int y) { return owner->data.data() + size_t(y) * owner->Width * 3; }
    } ScanLine{this};
    void resize(int w, int h, BYTE fill = 255) {
        Width = w;
        Height = h;
        data.assign(size_t(w) * h * 3, fill);
    }
};

struct Control {
    bool Checked = false, Down = false;
};

class WebReceiver {
public:
    std::unique_ptr<CSSTVDEM> dem;
    CSSTVDEM* pDem;
    Bitmap image, sync, completedImage;
    Bitmap *pBitmapRX = &image, *pBitmapD12 = &sync;
    Control slant, transmit;
    Control *KRSA = &slant, *SBTX = &transmit;
    short m_Y36[800]{}, m_D36[2][800]{}, *pCalibration = nullptr;
    int m_DSEL = 0, m_AX = -1, m_AY = -5, m_SyncAccuracy = 0;
    int m_SyncPos = -1, m_SyncRPos = -1, m_SyncMax = 0, m_SyncMin = 0;
    int m_Mult = 0, m_AutoStopPos = 0, m_AutoStopAPos[16]{}, m_AutoStopCnt = 0, m_AutoStopACnt = 0;
    int m_AutoSyncCount = 0, m_AutoSyncPos = 0, m_AutoSyncDis = 0, m_AutoSyncDiff = 0;
    int m_ASBgnPos = 0, m_ASCurY = 0, m_ASDis = 0, m_ASBitMask = 0, m_ASPos[4]{}, m_ReqSampChg = 0;
    double m_Z[3]{}, m_ASLmt[7]{25, 10, 2, .5, .2, .2, .08};
    CSmooz m_ASAvg;
    CLMS lms;
    CFFT fft;
    bool useLms = false, active = false, locked = false;
    int serial = 0, completed = 0, revision = 0, selected = -1;
    int completedMode = 0, completedSerial = 0, completedLine = 0;
    double completedFraction = 0;
    std::vector<short> stored, storedSync;
    std::unique_ptr<CHILL> faxDem;
    std::vector<double> faxBuffer;
    int faxClock = -1, faxSync = 0;
    bool faxGap = false, faxDone = false;
    void faxSample(double value);
    WebReceiver();
    void reset(int mode);
    void process(const float* data, int count);
    void drain();
    void begin();
    void finish();
    void redraw(double ppm, double phase);
    void RxAutoPush(int) { finish(); }
    void SyncSSTV();
    void InitAutoStop();
    int GetSqerrPos(int n);
    int AutoStopJob();
    int GetPixelLevel(short* ip);
    int GetPictureLevel(short* ip);
    int GetPictureLevelDiff(short* ip);
    void DrawSSTVNormal(short* ip, short* sp);
    void DrawSSTVDiff(short* ip, short* sp);
};
