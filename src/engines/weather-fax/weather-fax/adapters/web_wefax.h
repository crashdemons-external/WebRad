#pragma once
// Replace fldigi picture windows with the shared browser receive buffer.
struct LPM_VALUES {
    int m_value;
    const char* m_label;
};

inline LPM_VALUES all_lpm_values[4] = {
    {240, "240"},
    {120, "120"},
    {90, "90"},
    {60, "60"}
};
void web_fax_new_page(int);
void web_fax_complete(bool force = false);
void web_fax_begin_image(int);
extern bool web_fax_auto;

inline void activate_wefax_image_item(bool) {}

namespace wefax_pic {
inline int width = 1809;

inline void resize_rx_viewer(int w) {
    width = w;
    web_fax_new_page(w);
}

inline void update_rx_pic_bw(int value, int offset) {
    web_image_gray(value, offset, width);
}

inline void save_image(const std::string&, const std::string&) {}
inline void setwefax_map_link(wefax*) {}
inline void create_both(bool) {}
inline void restart_tx_viewer() {}
inline void set_manual(bool) {}
}
