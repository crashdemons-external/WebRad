#pragma once
// Qt-compatible types used by the modem.
#include <cstdint>
#include <cstring>
#include <cmath>
#include <cfloat>
#include <vector>
#include <string>
#include <complex>
#include <algorithm>
using uint = unsigned int;
using quint16 = uint16_t;
using quint32 = uint32_t;
class QByteArray : public std::string {
public:
    using std::string::string;
    QByteArray(const std::string& s) : std::string(s) {}
    int count() const { return size(); }
};

class QString : public std::string {
public:
    using std::string::string;
    QString(const std::string& s) : std::string(s) {}
    QByteArray toLatin1() const { return QByteArray(*this); }

    // Formatted desktop messages are unused by the browser modem.
    template<class T, class... A>
    QString arg(T, A...) const { return *this; }
};

template<class T>
class QList : public std::vector<T> {
public:
    int count() const { return this->size(); }
    void append(T v) { this->push_back(v); }
};

struct QuietLog {
    template<class T>
    QuietLog& operator<<(const T&) { return *this; }
};
inline QuietLog qDebug() { return {}; }

// Strip desktop-only logging without evaluating formatted arguments.
#define addToLog(...) ((void)0)
#define arrayDump(...) ((void)0)
#define arrayComplexDump(...) ((void)0)
#define arrayBinDump(...) ((void)0)
